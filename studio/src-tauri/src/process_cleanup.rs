//! Terminate only an owned child's process tree, never processes matched by name.
use std::io;
use std::process::{Command, ExitStatus, Stdio};

pub fn kill_tree(process_id: u32) -> io::Result<ExitStatus> {
    if process_id <= 1 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Invalid child process identifier",
        ));
    }
    #[cfg(windows)]
    let mut command = {
        use std::os::windows::process::CommandExt;
        let mut command = Command::new("taskkill");
        command.args(["/PID", &process_id.to_string(), "/T", "/F"]);
        command.creation_flags(0x0800_0000);
        command
    };
    #[cfg(unix)]
    let mut command = {
        let mut command = Command::new("/bin/kill");
        command.args(["-KILL", "--", &format!("-{process_id}")]);
        command
    };
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::process::CommandExt;

    #[test]
    fn kills_and_reaps_an_owned_process_group() {
        let mut child = Command::new("sleep")
            .arg("30")
            .process_group(0)
            .spawn()
            .unwrap();
        assert!(kill_tree(child.id()).unwrap().success());
        assert!(!child.wait().unwrap().success());
    }

    #[test]
    fn refuses_invalid_process_identifiers() {
        assert!(kill_tree(0).is_err());
        assert!(kill_tree(1).is_err());
    }
}
