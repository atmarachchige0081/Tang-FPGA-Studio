use crate::models::{GitChange, GitStatus};
use crate::security::{canonical_workspace, resolve_project_path};
use regex::Regex;
use std::path::{Path, PathBuf};
use std::process::Command;

const MAX_GIT_CHANGES: usize = 2_000;

pub fn status(root: &str, project: &str) -> Result<GitStatus, String> {
    let workspace = canonical_workspace(root)?;
    let project = resolve_project_path(&workspace, project)?;
    let Some(executable) = find_git() else {
        return Ok(GitStatus {
            available: false,
            repository: false,
            executable: None,
            version: None,
            branch: None,
            upstream: None,
            ahead: 0,
            behind: 0,
            changes: Vec::new(),
            message: "Git was not found. Install Git for Windows, then press Refresh.".into(),
        });
    };
    let version = run(&executable, &project, &["--version"])
        .ok()
        .map(|value| value.trim().to_owned());
    let output = match run(
        &executable,
        &project,
        &[
            "-c",
            "core.quotepath=false",
            "status",
            "--porcelain=v1",
            "--branch",
            "--untracked-files=normal",
            "--ignore-submodules=all",
            "--",
            ".",
        ],
    ) {
        Ok(value) => value,
        Err(error) if error.to_ascii_lowercase().contains("not a git repository") => {
            return Ok(GitStatus {
                available: true,
                repository: false,
                executable: Some(executable.to_string_lossy().into_owned()),
                version,
                branch: None,
                upstream: None,
                ahead: 0,
                behind: 0,
                changes: Vec::new(),
                message: "The active project is not a Git repository.".into(),
            });
        }
        Err(error) => return Err(error),
    };
    let (branch, upstream, ahead, behind, changes, truncated) = parse_status(&output);
    let message = if truncated {
        "More than 2,000 changes exist; showing the first 2,000"
    } else if changes.is_empty() {
        "Working tree clean"
    } else {
        "Local changes detected"
    };
    Ok(GitStatus {
        available: true,
        repository: true,
        executable: Some(executable.to_string_lossy().into_owned()),
        version,
        branch,
        upstream,
        ahead,
        behind,
        changes,
        message: message.into(),
    })
}

fn find_git() -> Option<PathBuf> {
    let mut candidates = vec![PathBuf::from("git.exe")];
    if let Ok(program_files) = std::env::var("ProgramFiles") {
        candidates.push(PathBuf::from(program_files).join("Git/cmd/git.exe"));
    }
    if let Ok(program_files_x86) = std::env::var("ProgramFiles(x86)") {
        candidates.push(PathBuf::from(program_files_x86).join("Git/cmd/git.exe"));
    }
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        candidates.push(PathBuf::from(local_app_data).join("Programs/Git/cmd/git.exe"));
    }
    candidates.into_iter().find(|candidate| {
        Command::new(candidate)
            .arg("--version")
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    })
}

fn run(executable: &Path, directory: &Path, arguments: &[&str]) -> Result<String, String> {
    let output = Command::new(executable)
        .args(arguments)
        .current_dir(directory)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|error| format!("Cannot start Git: {error}"))?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        return Err(if message.is_empty() {
            "Git did not complete".into()
        } else {
            message
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn parse_status(
    output: &str,
) -> (
    Option<String>,
    Option<String>,
    u32,
    u32,
    Vec<GitChange>,
    bool,
) {
    let tracking =
        Regex::new(r"^(?P<branch>.+?)(?:\.\.\.(?P<upstream>[^ ]+))?(?: \[(?P<tracking>.+)\])?$")
            .unwrap();
    let count = Regex::new(r"(ahead|behind) (\d+)").unwrap();
    let mut branch = None;
    let mut upstream = None;
    let mut ahead = 0;
    let mut behind = 0;
    let mut changes = Vec::new();
    let mut truncated = false;
    for line in output.lines() {
        if let Some(header) = line.strip_prefix("## ") {
            if let Some(captures) = tracking.captures(header) {
                branch = captures
                    .name("branch")
                    .map(|value| value.as_str().to_owned());
                upstream = captures
                    .name("upstream")
                    .map(|value| value.as_str().to_owned());
                if let Some(value) = captures.name("tracking") {
                    for item in count.captures_iter(value.as_str()) {
                        let parsed = item[2].parse().unwrap_or(0);
                        if &item[1] == "ahead" {
                            ahead = parsed;
                        } else {
                            behind = parsed;
                        }
                    }
                }
            }
        } else if line.len() >= 3 {
            if changes.len() >= MAX_GIT_CHANGES {
                truncated = true;
                continue;
            }
            let bytes = line.as_bytes();
            let path = line[3..].split(" -> ").last().unwrap_or("").to_owned();
            changes.push(GitChange {
                path,
                index_status: char::from(bytes[0]).to_string(),
                worktree_status: char::from(bytes[1]).to_string(),
            });
        }
    }
    (branch, upstream, ahead, behind, changes, truncated)
}

#[cfg(test)]
mod tests {
    use super::{parse_status, MAX_GIT_CHANGES};

    #[test]
    fn parses_branch_tracking_and_changes() {
        let (branch, upstream, ahead, behind, changes, truncated) = parse_status(
            "## develop/v2.0.0...origin/develop/v2.0.0 [ahead 2, behind 1]\n M studio/src/App.tsx\n?? new.sv\n",
        );
        assert_eq!(branch.as_deref(), Some("develop/v2.0.0"));
        assert_eq!(upstream.as_deref(), Some("origin/develop/v2.0.0"));
        assert_eq!((ahead, behind), (2, 1));
        assert_eq!(changes.len(), 2);
        assert!(!truncated);
    }

    #[test]
    fn bounds_large_change_sets_before_they_reach_the_ui() {
        let output = (0..2_100)
            .map(|index| format!("?? generated/{index}.sv\n"))
            .collect::<String>();
        let (_, _, _, _, changes, truncated) = parse_status(&output);
        assert_eq!(changes.len(), MAX_GIT_CHANGES);
        assert!(truncated);
    }
}
