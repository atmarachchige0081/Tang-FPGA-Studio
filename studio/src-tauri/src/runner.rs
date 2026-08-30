use crate::models::{BuildAction, BuildEvent, CommandResult, Diagnostic, DiagnosticSeverity};
use crate::reports;
use crate::security::{canonical_workspace, child_process_path, safe_existing_path};
use chrono::Utc;
use regex::Regex;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const MAX_CAPTURED_LINES: usize = 20_000;
const PROGRAMMER_TIMEOUT: Duration = Duration::from_secs(90);

#[derive(Default)]
struct JobState {
    jobs: HashMap<String, Arc<AtomicBool>>,
    projects: HashMap<String, String>,
}

#[derive(Default, Clone)]
pub struct JobRegistry {
    state: Arc<Mutex<JobState>>,
}

impl JobRegistry {
    fn insert(&self, id: String, project: String, flag: Arc<AtomicBool>) -> Result<(), String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Job registry is unavailable")?;
        if let Some(existing) = state.projects.get(&project) {
            return Err(format!("Another FPGA job ({existing}) is already running for this project. Wait for it to finish or press Stop."));
        }
        if state.jobs.contains_key(&id) {
            return Err("A job with this identifier is already running".into());
        }
        state.projects.insert(project, id.clone());
        state.jobs.insert(id, flag);
        Ok(())
    }

    fn remove(&self, id: &str) {
        if let Ok(mut state) = self.state.lock() {
            state.jobs.remove(id);
            state.projects.retain(|_, job_id| job_id != id);
        }
    }

    pub fn cancel(&self, id: &str) -> Result<bool, String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "Job registry is unavailable")?;
        if let Some(flag) = state.jobs.get(id) {
            flag.store(true, Ordering::SeqCst);
            Ok(true)
        } else {
            Ok(false)
        }
    }
}

pub async fn run(
    app: AppHandle,
    registry: JobRegistry,
    root: String,
    project: String,
    action: BuildAction,
    requested_job_id: String,
) -> Result<CommandResult, String> {
    let job_id = if requested_job_id.len() <= 80
        && requested_job_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        requested_job_id
    } else {
        uuid::Uuid::new_v4().to_string()
    };
    tauri::async_runtime::spawn_blocking(move || {
        run_blocking(app, registry, root, project, action, job_id)
    })
    .await
    .map_err(|error| format!("FPGA job worker stopped unexpectedly: {error}"))?
}

fn run_blocking(
    app: AppHandle,
    registry: JobRegistry,
    root: String,
    project: String,
    action: BuildAction,
    job_id: String,
) -> Result<CommandResult, String> {
    let workspace = canonical_workspace(&root)?;
    let process_workspace = child_process_path(&workspace);
    let project_dir = safe_existing_path(&workspace, &project)?;
    if !project_dir.is_dir() || !project_dir.join("fpga.config.psd1").is_file() {
        return Err("The active project has no fpga.config.psd1".into());
    }
    let cancellation = Arc::new(AtomicBool::new(false));
    let project_key = project_dir.to_string_lossy().to_ascii_lowercase();
    registry.insert(job_id.clone(), project_key, cancellation.clone())?;
    let started = Instant::now();
    emit(
        &app,
        &job_id,
        action.as_str(),
        "system",
        "Starting FPGA toolchain job",
    );

    let mut command = Command::new("powershell.exe");
    command
        .arg("-NoLogo")
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-File")
        .arg(process_workspace.join("fpga.ps1"))
        .arg(action.as_str())
        .arg("-Project")
        .arg(&project)
        .current_dir(&process_workspace)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            registry.remove(&job_id);
            return Err(format!("Cannot start PowerShell: {error}"));
        }
    };
    let process_id = child.id();
    let stdout = child
        .stdout
        .take()
        .ok_or("FPGA job stdout is unavailable")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("FPGA job stderr is unavailable")?;
    let (sender, receiver) = mpsc::channel::<(&'static str, String)>();
    for (stream, pipe) in [
        ("stdout", Box::new(stdout) as Box<dyn std::io::Read + Send>),
        ("stderr", Box::new(stderr) as Box<dyn std::io::Read + Send>),
    ] {
        let sender = sender.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                if sender.send((stream, line)).is_err() {
                    break;
                }
            }
        });
    }
    drop(sender);

    let mut captured = Vec::new();
    let mut programmer_started = None;
    let mut termination_requested = false;
    let exit_status = loop {
        match receiver.recv_timeout(Duration::from_millis(35)) {
            Ok((stream, line)) => {
                if line
                    .trim_start()
                    .to_ascii_lowercase()
                    .starts_with("> openfpgaloader")
                {
                    programmer_started = Some(Instant::now());
                }
                emit(&app, &job_id, action.as_str(), stream, &line);
                push_captured(&mut captured, line);
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                break child
                    .wait()
                    .map_err(|error| format!("Cannot wait for FPGA job: {error}"))?;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        if cancellation.load(Ordering::SeqCst) && !termination_requested {
            termination_requested = true;
            terminate_process_tree(process_id, &mut child);
            emit(
                &app,
                &job_id,
                action.as_str(),
                "system",
                "Cancellation requested",
            );
        }
        if !termination_requested
            && programmer_started.is_some_and(|started| started.elapsed() >= PROGRAMMER_TIMEOUT)
        {
            termination_requested = true;
            let message =
                "FPGA programmer timed out after 90 seconds; its process was stopped safely.";
            emit(&app, &job_id, action.as_str(), "system", message);
            push_captured(&mut captured, message.into());
            terminate_process_tree(process_id, &mut child);
        }
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("Cannot inspect FPGA job: {error}"))?
        {
            while let Ok((stream, line)) = receiver.try_recv() {
                emit(&app, &job_id, action.as_str(), stream, &line);
                push_captured(&mut captured, line);
            }
            break status;
        }
    };
    registry.remove(&job_id);
    let diagnostics = parse_diagnostics(&captured);
    let success = exit_status.success() && !cancellation.load(Ordering::SeqCst);
    let duration_ms = started.elapsed().as_millis();
    let failure_message = (!success).then(|| friendly_failure(action, &captured));
    if let Err(error) = reports::record_history(
        &process_workspace.to_string_lossy(),
        &project,
        action,
        success,
        duration_ms,
    ) {
        emit(
            &app,
            &job_id,
            action.as_str(),
            "system",
            &format!("Build history was not saved: {error}"),
        );
    }
    Ok(CommandResult {
        job_id,
        action,
        success,
        exit_code: exit_status.code(),
        duration_ms,
        diagnostics,
        failure_message,
    })
}

fn push_captured(captured: &mut Vec<String>, line: String) {
    if captured.len() >= MAX_CAPTURED_LINES {
        captured.drain(..5_000);
    }
    captured.push(line);
}

fn emit(app: &AppHandle, job_id: &str, phase: &str, stream: &str, message: &str) {
    let _ = app.emit(
        "fpga-build-event",
        BuildEvent {
            job_id: job_id.to_owned(),
            phase: phase.to_owned(),
            stream: stream.to_owned(),
            message: message.to_owned(),
            timestamp: Utc::now().to_rfc3339(),
        },
    );
}

fn terminate_process_tree(process_id: u32, child: &mut std::process::Child) {
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &process_id.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = child.kill();
}

fn parse_diagnostics(lines: &[String]) -> Vec<Diagnostic> {
    let location = Regex::new(r"(?i)^(?P<file>[^:]+\.(?:v|sv|vh|svh)):(?P<line>\d+)(?::(?P<column>\d+))?[: ]+(?P<message>.+)$").expect("diagnostic regex is valid");
    lines
        .iter()
        .filter_map(|line| {
            let trimmed = line.trim_start();
            if trimmed.starts_with("At ")
                || trimmed.starts_with('+')
                || trimmed.starts_with('~')
                || trimmed.starts_with("CategoryInfo")
                || trimmed.starts_with("FullyQualifiedErrorId")
            {
                return None;
            }
            let lower = line.to_ascii_lowercase();
            let severity = if lower.contains("error") || lower.contains("%fatal") {
                DiagnosticSeverity::Error
            } else if lower.contains("warning") || lower.contains("%warn") {
                DiagnosticSeverity::Warning
            } else {
                return None;
            };
            let captures = location.captures(line);
            Some(Diagnostic {
                severity,
                source: "toolchain".into(),
                message: captures
                    .as_ref()
                    .and_then(|value| value.name("message"))
                    .map_or_else(
                        || line.trim().to_owned(),
                        |value| value.as_str().trim().to_owned(),
                    ),
                code: None,
                suggestion: None,
                file: captures
                    .as_ref()
                    .and_then(|value| value.name("file"))
                    .map(|value| value.as_str().replace('\\', "/")),
                line: captures
                    .as_ref()
                    .and_then(|value| value.name("line"))
                    .and_then(|value| value.as_str().parse().ok()),
                column: captures
                    .as_ref()
                    .and_then(|value| value.name("column"))
                    .and_then(|value| value.as_str().parse().ok()),
            })
        })
        .take(500)
        .collect()
}

fn friendly_failure(action: BuildAction, lines: &[String]) -> String {
    let combined = lines.join("\n").to_ascii_lowercase();
    if combined.contains("device not found")
        || combined.contains("no jtag probe")
        || combined.contains("no cable found")
    {
        return "No JTAG programmer is currently visible. Connect the board port marked JTAG/UART or MCU directly to the computer, confirm the FPGA/SOM is enabled, then run Detect JTAG again.".into();
    }
    if combined.contains("ftdi_usb_reset failed")
        || combined.contains("ftdi reset failed")
        || combined.contains("unable to configure bitbang mode")
        || combined.contains("unable to config pins")
    {
        return "JTAG Interface 0 already uses WinUSB, but the FTDI controller did not respond to reset. Unplug the board's JTAG USB cable, wait 3 seconds, reconnect it, then run Detect JTAG. Do not replace either interface driver.".into();
    }
    if combined.contains("usb_open() failed") || combined.contains("unable to open ftdi device") {
        return "The JTAG adapter could not be opened. Close other programmer tools, reconnect the board directly without a hub, and retry. If Hardware Doctor lists Interface 0, verify that only Interface 0 uses WinUSB; leave Interface 1 unchanged for UART.".into();
    }
    if combined.contains("usb bulk write failed")
        || combined.contains("low level ftdi init failed")
        || combined.contains("fpga programmer timed out")
    {
        return "The JTAG USB interface stopped responding. Unplug the board USB cable, wait 3 seconds, reconnect it, then run Detect JTAG before retrying SRAM. Do not change the Zadig drivers.".into();
    }
    if combined.contains("oss cad suite is not installed") || combined.contains("environment.ps1") {
        return "The FPGA toolchain is not ready. Run the setup command, then Hardware Doctor, before trying again.".into();
    }
    if combined.contains("value of argument \"drive\" is null")
        || combined.contains("psargumentnullexception")
    {
        return "FPGA Studio could not pass the workspace path to Windows PowerShell. Restart the updated application and retry; your source files were not changed.".into();
    }
    if combined.contains("checksum data is truncated")
        || combined.contains("can't parse file")
        || combined.contains("cannot safely parse their checksum")
    {
        return "The programmer rejected the generated bitstream before writing the FPGA. Rebuild with the updated uncompressed Gowin packer setting, then retry SRAM upload. The failed attempt did not damage the board.".into();
    }
    if combined.contains("timing") && (combined.contains("failed") || combined.contains("error")) {
        return "Implementation did not meet the requested timing or placement constraints. Open Problems for the first actionable tool message.".into();
    }
    let useful = lines.iter().find_map(|line| {
        let trimmed = line.trim();
        let lower = trimmed.to_ascii_lowercase();
        let technical = trimmed.is_empty()
            || trimmed.starts_with("At ")
            || trimmed.starts_with('+')
            || trimmed.starts_with('~')
            || trimmed.starts_with("CategoryInfo")
            || trimmed.starts_with("FullyQualifiedErrorId");
        (!technical && (lower.contains("error") || lower.contains("failed")))
            .then(|| trimmed.to_owned())
    });
    useful.unwrap_or_else(|| {
        format!(
            "{} did not complete. Open Problems for the actionable message or enable Technical details for the full tool log.",
            action.as_str().to_ascii_uppercase()
        )
    })
}

#[cfg(test)]
mod tests {
    use super::{friendly_failure, parse_diagnostics, JobRegistry};
    use crate::models::BuildAction;
    use crate::models::DiagnosticSeverity;

    #[test]
    fn extracts_hdl_diagnostics() {
        let values = parse_diagnostics(&["rtl/top.sv:18:7: warning: unused signal".into()]);
        assert_eq!(values.len(), 1);
        assert!(matches!(values[0].severity, DiagnosticSeverity::Warning));
        assert_eq!(values[0].line, Some(18));
    }

    #[test]
    fn explains_ftdi_reset_without_suggesting_driver_replacement() {
        let message = friendly_failure(
            BuildAction::Detect,
            &["unable to open ftdi device: -6 (ftdi_usb_reset failed)".into()],
        );
        assert!(message.contains("Unplug"));
        assert!(message.contains("Do not replace"));
    }

    #[test]
    fn distinguishes_an_absent_programmer_from_a_driver_failure() {
        let message = friendly_failure(
            BuildAction::Detect,
            &["unable to open ftdi device: -3 (device not found)".into()],
        );
        assert!(message.contains("No JTAG programmer"));
        assert!(!message.contains("Windows cannot open"));
        assert!(!message.contains("WinUSB"));
    }

    #[test]
    fn hides_powershell_stack_noise_and_explains_jtag_access() {
        let values = parse_diagnostics(&[
            "At C:\\fpga.ps1:25 char:5".into(),
            "+ CategoryInfo : InvalidArgument".into(),
            "FullyQualifiedErrorId : ArgumentNull".into(),
        ]);
        assert!(values.is_empty());
        assert!(friendly_failure(
            BuildAction::Detect,
            &["unable to open ftdi device: -4 (usb_open() failed)".into()]
        )
        .contains("Interface 0"));
    }

    #[test]
    fn explains_incompatible_compressed_gowin_bitstreams() {
        let message = friendly_failure(
            BuildAction::Upload,
            &[
                "Reports: build/yosys.log and build/timing.json".into(),
                "FsParser: checksum data is truncated".into(),
                "Error: Failed to claim FPGA device: can't parse file".into(),
            ],
        );
        assert!(message.contains("uncompressed Gowin"));
        assert!(!message.contains("timing"));
    }

    #[test]
    fn explains_stalled_or_reset_jtag_interfaces() {
        let bulk = friendly_failure(
            BuildAction::Upload,
            &["mpsse_write: fail to write with error -1 (usb bulk write failed)".into()],
        );
        assert!(bulk.contains("Unplug"));
        assert!(bulk.contains("Do not change the Zadig drivers"));

        let timeout = friendly_failure(
            BuildAction::Upload,
            &["FPGA programmer timed out after 90 seconds".into()],
        );
        assert!(timeout.contains("Detect JTAG"));
    }

    #[test]
    fn permits_only_one_job_per_project() {
        let registry = JobRegistry::default();
        let flag = || std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        registry
            .insert("job-a".into(), "project-a".into(), flag())
            .unwrap();
        assert!(registry
            .insert("job-b".into(), "project-a".into(), flag())
            .is_err());
        registry
            .insert("job-c".into(), "project-b".into(), flag())
            .unwrap();
        registry.remove("job-a");
        registry
            .insert("job-d".into(), "project-a".into(), flag())
            .unwrap();
    }

    #[test]
    fn concurrent_starts_cannot_share_a_project() {
        let registry = JobRegistry::default();
        let accepted = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let mut threads = Vec::new();
        for index in 0..32 {
            let registry = registry.clone();
            let accepted = accepted.clone();
            threads.push(std::thread::spawn(move || {
                let flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
                if registry
                    .insert(format!("job-{index}"), "same-project".into(), flag)
                    .is_ok()
                {
                    accepted.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                }
            }));
        }
        for thread in threads {
            thread.join().unwrap();
        }
        assert_eq!(accepted.load(std::sync::atomic::Ordering::SeqCst), 1);
    }
}
