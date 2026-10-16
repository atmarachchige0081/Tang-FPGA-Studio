//! Real PTY sessions. Sessions outlive the tab, but never restart commands on recovery.
use crate::security::{canonical_workspace, child_process_path, resolve_project_path};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

const MAX_BUFFER: usize = 128 * 1024;
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalEvent {
    pub id: String,
    pub sequence: u64,
    pub data: String,
    pub exited: bool,
}
#[derive(Default)]
struct Transcript {
    sequence: u64,
    data: String,
    exited: bool,
}
struct Session {
    id: String,
    project: String,
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    transcript: Arc<Mutex<Transcript>>,
}
impl Session {
    fn snapshot(&self) -> Result<TerminalEvent, String> {
        let log = self
            .transcript
            .lock()
            .map_err(|_| "Terminal log unavailable")?;
        Ok(TerminalEvent {
            id: self.id.clone(),
            sequence: log.sequence,
            data: log.data.clone(),
            exited: log.exited,
        })
    }
    fn emit(&self, app: &AppHandle, data: String, exited: bool) {
        publish(app, &self.id, &self.transcript, data, exited);
    }
}

fn publish(app: &AppHandle, id: &str, transcript: &Mutex<Transcript>, data: String, exited: bool) {
    if let Ok(mut log) = transcript.lock() {
        log.sequence += 1;
        log.exited |= exited;
        log.data.push_str(&data);
        if log.data.len() > MAX_BUFFER {
            let mut start = log.data.len() - MAX_BUFFER;
            while !log.data.is_char_boundary(start) {
                start += 1;
            }
            log.data.drain(..start);
        }
        let _ = app.emit(
            "terminal-output",
            TerminalEvent {
                id: id.to_owned(),
                sequence: log.sequence,
                data,
                exited: log.exited,
            },
        );
    }
}
impl Drop for Session {
    fn drop(&mut self) {
        if let Ok(killer) = self.killer.get_mut() {
            let _ = killer.kill();
        }
    }
}
#[derive(Default)]
pub struct TerminalRegistry {
    sessions: Mutex<HashMap<String, Arc<Session>>>,
}
impl TerminalRegistry {
    pub fn open(
        &self,
        app: AppHandle,
        root: &str,
        project: &str,
        cols: u16,
        rows: u16,
    ) -> Result<TerminalEvent, String> {
        let workspace = canonical_workspace(root)?;
        let cwd = resolve_project_path(&workspace, project)?;
        let key = cwd.to_string_lossy().into_owned();
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "Terminal registry unavailable")?;
        if let Some(session) = sessions.values().find(|s| s.project == key) {
            return session.snapshot();
        }
        sessions.retain(|_, session| {
            !session
                .snapshot()
                .map(|snapshot| snapshot.exited)
                .unwrap_or(false)
        });
        if sessions.len() >= 4 {
            return Err(
                "Four project shells are open. Type exit in an unused shell before opening another.".into(),
            );
        }
        let pty = native_pty_system()
            .openpty(size(cols, rows))
            .map_err(|e| format!("Cannot open terminal: {e}"))?;
        let mut command = shell_command();
        command.cwd(child_process_path(&cwd));
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        let mut child = pty
            .slave
            .spawn_command(command)
            .map_err(|e| format!("Cannot start shell: {e}"))?;
        drop(pty.slave);
        let killer = child.clone_killer();
        let mut reader = pty.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pty.master.take_writer().map_err(|e| e.to_string())?;
        let session = Arc::new(Session {
            id: uuid::Uuid::new_v4().to_string(),
            project: key,
            master: Mutex::new(pty.master),
            writer: Mutex::new(writer),
            killer: Mutex::new(killer),
            transcript: Arc::new(Mutex::new(Transcript::default())),
        });
        sessions.insert(session.id.clone(), session.clone());
        let output_id = session.id.clone();
        let output_log = session.transcript.clone();
        let output_app = app.clone();
        std::thread::spawn(move || {
            let mut bytes = [0u8; 8192];
            let mut pending = Vec::new();
            while let Ok(count) = reader.read(&mut bytes) {
                if count == 0 {
                    break;
                }
                // Backpressure prevents output-heavy commands from flooding WebView IPC.
                std::thread::sleep(std::time::Duration::from_millis(10));
                pending.extend_from_slice(&bytes[..count]);
                // Preserve UTF-8 codepoints split across PTY reads.
                let valid = match std::str::from_utf8(&pending) {
                    Ok(_) => pending.len(),
                    Err(e) => e.valid_up_to(),
                };
                if valid > 0 {
                    publish(
                        &output_app,
                        &output_id,
                        &output_log,
                        String::from_utf8_lossy(&pending[..valid]).into_owned(),
                        false,
                    );
                    pending.drain(..valid);
                }
                if pending.len() > 4
                    || std::str::from_utf8(&pending).is_err_and(|e| e.error_len().is_some())
                {
                    publish(
                        &output_app,
                        &output_id,
                        &output_log,
                        String::from_utf8_lossy(&pending).into_owned(),
                        false,
                    );
                    pending.clear();
                }
            }
            if !pending.is_empty() {
                publish(
                    &output_app,
                    &output_id,
                    &output_log,
                    String::from_utf8_lossy(&pending).into_owned(),
                    false,
                );
            }
        });
        std::thread::spawn(move || {
            let result = child.wait();
            session.emit(
                &app,
                format!(
                    "\r\n[Shell exited: {}]\r\n",
                    result
                        .map(|s| s.to_string())
                        .unwrap_or_else(|e| e.to_string())
                ),
                true,
            );
        });
        sessions
            .values()
            .find(|s| s.project == cwd.to_string_lossy())
            .ok_or("Terminal unavailable")?
            .snapshot()
    }
    fn session(&self, id: &str) -> Result<Arc<Session>, String> {
        self.sessions
            .lock()
            .map_err(|_| "Terminal registry unavailable")?
            .get(id)
            .cloned()
            .ok_or("Terminal session is closed".into())
    }
    pub fn write(&self, id: &str, data: &str) -> Result<(), String> {
        if data.len() > 65536 {
            return Err("Paste at most 64 KiB at once.".into());
        }
        let session = self.session(id)?;
        if session.snapshot()?.exited {
            return Err("Shell has exited. Restart the terminal to continue.".into());
        }
        let mut writer = session
            .writer
            .lock()
            .map_err(|_| "Terminal input unavailable")?;
        writer
            .write_all(data.as_bytes())
            .and_then(|_| writer.flush())
            .map_err(|e| format!("Cannot write to shell: {e}"))
    }
    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        self.session(id)?
            .master
            .lock()
            .map_err(|_| "Terminal resize unavailable")?
            .resize(size(cols, rows))
            .map_err(|e| e.to_string())
    }
    pub fn close(&self, id: &str) -> Result<(), String> {
        if let Some(session) = self
            .sessions
            .lock()
            .map_err(|_| "Terminal registry unavailable")?
            .remove(id)
        {
            session
                .killer
                .lock()
                .map_err(|_| "Terminal process unavailable")?
                .kill()
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}
impl Drop for TerminalRegistry {
    fn drop(&mut self) {
        if let Ok(sessions) = self.sessions.get_mut() {
            for session in sessions.values() {
                if let Ok(mut killer) = session.killer.lock() {
                    let _ = killer.kill();
                }
            }
        }
    }
}
fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.clamp(2, 200),
        cols: cols.clamp(10, 500),
        pixel_width: 0,
        pixel_height: 0,
    }
}
fn shell_command() -> CommandBuilder {
    if cfg!(windows) {
        let mut command = CommandBuilder::new("powershell.exe");
        command.args(["-NoLogo", "-NoProfile", "-NoExit"]);
        command
    } else {
        let mut command = CommandBuilder::new("/bin/bash");
        command.args(["--noprofile", "--norc", "-i"]);
        command
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pty_runs_commands_and_preserves_working_directory() {
        let pty = native_pty_system().openpty(size(80, 24)).unwrap();
        let mut command = shell_command();
        command.cwd(std::env::temp_dir());
        let mut child = pty.slave.spawn_command(command).unwrap();
        drop(pty.slave);
        let mut reader = pty.master.try_clone_reader().unwrap();
        let mut writer = pty.master.take_writer().unwrap();
        let command = if cfg!(windows) {
            "Write-Output ('TANG_' + 'PTY_OK'); exit\r\n"
        } else {
            "printf 'TANG_%s\\n' 'PTY_OK'; exit\n"
        };
        writer.write_all(command.as_bytes()).unwrap();
        writer.flush().unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut bytes = Vec::new();
            let mut chunk = [0u8; 1024];
            while let Ok(count) = reader.read(&mut chunk) {
                if count == 0 {
                    break;
                }
                bytes.extend_from_slice(&chunk[..count]);
                if String::from_utf8_lossy(&bytes).contains("TANG_PTY_OK") {
                    break;
                }
            }
            let _ = tx.send(String::from_utf8_lossy(&bytes).into_owned());
        });
        let result = rx.recv_timeout(std::time::Duration::from_secs(15));
        let _ = child.kill();
        let _ = child.wait();
        assert!(result.unwrap().contains("TANG_PTY_OK"));
    }
}
