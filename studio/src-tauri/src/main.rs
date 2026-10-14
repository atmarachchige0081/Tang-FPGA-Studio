#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

fn crash_log_path() -> PathBuf {
    #[cfg(target_os = "linux")]
    let base = std::env::var_os("XDG_STATE_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/state")))
        .unwrap_or_else(std::env::temp_dir);
    #[cfg(not(target_os = "linux"))]
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    base.join("Tang FPGA Studio").join("logs").join("crash.log")
}

fn record_failure(message: &str) {
    let path = crash_log_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{:?} | {}", std::time::SystemTime::now(), message);
    }
}

#[cfg(windows)]
fn show_startup_failure() {
    use std::os::windows::process::CommandExt;
    let log = crash_log_path().to_string_lossy().replace('\'', "''");
    let script = format!("Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('FPGA Studio could not start safely. No project files were changed. Diagnostic details were saved to: {log}', 'FPGA Studio startup problem', 'OK', 'Error') | Out-Null");
    let mut command = std::process::Command::new("powershell.exe");
    command.creation_flags(0x0800_0000);
    let _ = command
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .status();
}

#[cfg(not(windows))]
fn show_startup_failure() {}

fn main() {
    let previous_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |details| {
        record_failure(&format!("Unexpected native panic: {details}"));
        previous_hook(details);
    }));
    let arguments = std::env::args().skip(1).collect::<Vec<_>>();
    if let Some(index) = arguments
        .iter()
        .position(|argument| argument == "--workspace")
    {
        let Some(workspace) = arguments.get(index + 1) else {
            std::process::exit(2);
        };
        std::env::set_var("FPGA_STUDIO_WORKSPACE", workspace);
    }
    if arguments.iter().any(|argument| argument == "--smoke-test") {
        match fpga_studio_lib::smoke_test() {
            Ok(()) => std::process::exit(0),
            Err(error) => {
                record_failure(&format!("Headless smoke test failed: {error}"));
                std::process::exit(1);
            }
        }
    }
    if let Err(error) = fpga_studio_lib::run() {
        record_failure(&error);
        show_startup_failure();
        std::process::exit(1);
    }
}
