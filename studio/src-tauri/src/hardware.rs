use crate::models::{SerialDevice, SerialEvent};
use crate::security::{canonical_workspace, child_process_path, resolve_project_path};
use chrono::Utc;
use serialport::{DataBits, FlowControl, Parity, SerialPort, StopBits};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub fn launch_zadig(root: &str, project: &str) -> Result<String, String> {
    #[cfg(not(windows))]
    {
        let _ = (root, project);
        return Err("Zadig is only required for the Windows JTAG driver".into());
    }

    #[cfg(windows)]
    {
        let workspace = canonical_workspace(root)?;
        let project_directory = resolve_project_path(&workspace, project)?;
        if !project_directory.join("fpga.config.psd1").is_file() {
            return Err("The active project has no fpga.config.psd1".into());
        }
        let process_workspace = child_process_path(&workspace);
        let mut command = Command::new("powershell.exe");
        command
            .arg("-NoLogo")
            .arg("-NoProfile")
            .arg("-NonInteractive")
            .arg("-ExecutionPolicy")
            .arg("Bypass")
            .arg("-File")
            .arg(process_workspace.join("fpga.ps1"))
            .arg("driver")
            .arg("-Project")
            .arg(project)
            .current_dir(&process_workspace)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
        let output = command
            .output()
            .map_err(|error| format!("Cannot start the verified Zadig helper: {error}"))?;
        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_owned();
            return Err(if detail.is_empty() {
                "The verified Zadig helper could not be opened. Run '.\\fpga.ps1 driver' for details."
                    .into()
            } else {
                detail
            });
        }
        Ok("Verified Zadig opened. Configure Interface 0 as WinUSB, leave Interface 1 unchanged, then run Detect JTAG again.".into())
    }
}

struct SerialSession {
    port: Arc<Mutex<Box<dyn SerialPort>>>,
    cancel: Arc<AtomicBool>,
}

#[derive(Clone, Default)]
pub struct SerialRegistry {
    sessions: Arc<Mutex<HashMap<String, SerialSession>>>,
}

pub fn serial_devices() -> Result<Vec<SerialDevice>, String> {
    let mut devices = serialport::available_ports()
        .map_err(|error| format!("Cannot enumerate serial devices: {error}"))?
        .into_iter()
        .map(|port| {
            let (display_name, vendor_id, product_id, likely_board) = match port.port_type {
                serialport::SerialPortType::UsbPort(info) => {
                    let name = info.product.unwrap_or_else(|| "USB serial device".into());
                    let likely = (info.vid == 0x0403 && info.pid == 0x6010)
                        || name.to_ascii_lowercase().contains("jtag")
                        || name.to_ascii_lowercase().contains("tang");
                    (name, Some(info.vid), Some(info.pid), likely)
                }
                serialport::SerialPortType::BluetoothPort => {
                    ("Bluetooth serial device".into(), None, None, false)
                }
                serialport::SerialPortType::PciPort => {
                    ("PCI serial device".into(), None, None, false)
                }
                serialport::SerialPortType::Unknown => ("Serial device".into(), None, None, false),
            };
            SerialDevice {
                port_name: port.port_name,
                display_name,
                vendor_id,
                product_id,
                likely_board,
            }
        })
        .collect::<Vec<_>>();
    devices.sort_by(|left, right| left.port_name.cmp(&right.port_name));
    Ok(devices)
}

pub fn connect(
    app: AppHandle,
    registry: SerialRegistry,
    port_name: String,
    baud_rate: u32,
    session_id: String,
) -> Result<(), String> {
    if session_id.is_empty()
        || session_id.len() > 80
        || !session_id
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '-' | '_'))
    {
        return Err("Serial session identifier is invalid".into());
    }
    if !(300..=4_000_000).contains(&baud_rate) {
        return Err("Baud rate must be between 300 and 4,000,000".into());
    }
    let available = serialport::available_ports()
        .map_err(|error| format!("Cannot enumerate serial devices: {error}"))?;
    if !available.iter().any(|port| port.port_name == port_name) {
        return Err(format!("Serial port '{port_name}' is not available"));
    }
    let port = serialport::new(&port_name, baud_rate)
        .data_bits(DataBits::Eight)
        .parity(Parity::None)
        .stop_bits(StopBits::One)
        .flow_control(FlowControl::None)
        .timeout(Duration::from_millis(75))
        .open()
        .map_err(|error| format!("Cannot open {port_name}: {error}"))?;
    let port = Arc::new(Mutex::new(port));
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut sessions = registry
            .sessions
            .lock()
            .map_err(|_| "Serial session registry is unavailable")?;
        if sessions.contains_key(&session_id) {
            return Err("A serial session with this identifier is already connected".into());
        }
        sessions.insert(
            session_id.clone(),
            SerialSession {
                port: port.clone(),
                cancel: cancel.clone(),
            },
        );
    }
    emit_serial(
        &app,
        &session_id,
        "status",
        Vec::new(),
        Some(format!("Connected to {port_name} at {baud_rate} baud")),
    );
    std::thread::spawn(move || {
        let mut buffer = [0_u8; 4096];
        while !cancel.load(Ordering::SeqCst) {
            let result = port
                .lock()
                .map_err(|_| std::io::Error::other("serial port lock failed"))
                .and_then(|mut port| port.read(&mut buffer));
            match result {
                Ok(count) if count > 0 => {
                    emit_serial(&app, &session_id, "data", buffer[..count].to_vec(), None)
                }
                Ok(_) => {}
                Err(error) if error.kind() == std::io::ErrorKind::TimedOut => {}
                Err(error) => {
                    emit_serial(
                        &app,
                        &session_id,
                        "error",
                        Vec::new(),
                        Some(format!("Serial read failed: {error}")),
                    );
                    break;
                }
            }
        }
        if let Ok(mut sessions) = registry.sessions.lock() {
            let owns_session = sessions
                .get(&session_id)
                .is_some_and(|session| Arc::ptr_eq(&session.cancel, &cancel));
            if owns_session {
                sessions.remove(&session_id);
            }
        }
    });
    Ok(())
}

pub fn write(registry: &SerialRegistry, session_id: &str, data: Vec<u8>) -> Result<(), String> {
    if data.is_empty() {
        return Ok(());
    }
    if data.len() > 64 * 1024 {
        return Err("A single serial write cannot exceed 64 KiB".into());
    }
    let sessions = registry
        .sessions
        .lock()
        .map_err(|_| "Serial session registry is unavailable")?;
    let session = sessions
        .get(session_id)
        .ok_or("Serial session is not connected")?;
    let mut port = session
        .port
        .lock()
        .map_err(|_| "Serial port is unavailable")?;
    port.write_all(&data)
        .and_then(|_| port.flush())
        .map_err(|error| format!("Serial write failed: {error}"))
}

pub fn disconnect(registry: &SerialRegistry, session_id: &str) -> Result<bool, String> {
    let mut sessions = registry
        .sessions
        .lock()
        .map_err(|_| "Serial session registry is unavailable")?;
    if let Some(session) = sessions.remove(session_id) {
        session.cancel.store(true, Ordering::SeqCst);
        Ok(true)
    } else {
        Ok(false)
    }
}

fn emit_serial(
    app: &AppHandle,
    session_id: &str,
    kind: &str,
    data: Vec<u8>,
    message: Option<String>,
) {
    let _ = app.emit(
        "fpga-serial-event",
        SerialEvent {
            session_id: session_id.to_owned(),
            kind: kind.to_owned(),
            data,
            message,
            timestamp: Utc::now().to_rfc3339(),
        },
    );
}
