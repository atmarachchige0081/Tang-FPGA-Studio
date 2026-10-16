//! Provider-independent, in-memory file-change journal. No Git or AI CLI required.
use crate::models::{NodeKind, ProjectNode};
use crate::project::{self, FileProbe};
use crate::security::{canonical_workspace, resolve_project_path};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

const MAX_FILES: usize = 512;
const MAX_FILE_BYTES: u64 = 256 * 1024;
const MAX_PROJECT_BYTES: u64 = 8 * 1024 * 1024;
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeHunk {
    pub old_start: usize,
    pub old_lines: usize,
    pub new_start: usize,
    pub new_lines: usize,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    pub before: String,
    pub after: String,
    pub kind: String,
    pub revision: u64,
    pub hunks: Vec<ChangeHunk>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeSnapshot {
    pub revision: u64,
    pub changes: Option<Vec<FileChange>>,
    pub limited: bool,
}
#[derive(Default)]
struct TrackedFile {
    version: String,
    content: String,
}
#[derive(Default)]
struct Journal {
    initialized: bool,
    revision: u64,
    files: HashMap<String, TrackedFile>,
    changes: HashMap<String, FileChange>,
    limited: bool,
}
#[derive(Default, Clone)]
pub struct ChangeRegistry {
    journals: Arc<Mutex<HashMap<PathBuf, Journal>>>,
}
impl ChangeRegistry {
    pub fn poll(
        &self,
        root: &str,
        project: &str,
        since: Option<u64>,
    ) -> Result<ChangeSnapshot, String> {
        let workspace = canonical_workspace(root)?;
        let directory = resolve_project_path(&workspace, project)?;
        let tree = project::project_tree(root, project)?;
        let mut candidates = Vec::new();
        flatten(&tree, &mut candidates);
        let mut registries = self
            .journals
            .lock()
            .map_err(|_| "File change journal unavailable")?;
        if registries.len() >= 4 && !registries.contains_key(&directory) {
            // Bound memory; the active project's journal always remains available.
            if let Some(old) = registries.keys().next().cloned() {
                registries.remove(&old);
            }
        }
        let journal = registries.entry(directory.clone()).or_default();
        let mut selected = Vec::new();
        let mut bytes = 0;
        let mut limited = false;
        for path in candidates {
            let absolute = if Path::new(&path).is_absolute() {
                PathBuf::from(&path)
            } else {
                workspace.join(&path)
            };
            let Ok(canonical) = std::fs::canonicalize(&absolute) else {
                continue;
            };
            if !canonical
                .strip_prefix(&directory)
                .map(|relative| tracked(&relative.to_string_lossy()))
                .unwrap_or(false)
            {
                continue;
            }
            let Ok(metadata) = std::fs::metadata(&absolute) else {
                continue;
            };
            if metadata.len() > MAX_FILE_BYTES
                || selected.len() >= MAX_FILES
                || bytes + metadata.len() > MAX_PROJECT_BYTES
            {
                limited = true;
                continue;
            }
            bytes += metadata.len();
            selected.push(path);
        }
        let selected_set: HashSet<_> = selected.iter().cloned().collect();
        let mut updates = Vec::new();
        for chunk in selected.chunks(64) {
            let probes = chunk
                .iter()
                .map(|path| FileProbe {
                    path: path.clone(),
                    version: journal
                        .files
                        .get(path)
                        .map(|file| file.version.clone())
                        .unwrap_or_default(),
                })
                .collect();
            updates.extend(project::sync_files(root, project, probes)?);
        }
        for update in updates {
            if update.error.is_some() {
                continue;
            }
            let Some(content) = update.content else {
                continue;
            };
            let previous = journal.files.get(&update.path);
            if journal.initialized && previous.map(|file| file.content.as_str()) != Some(&content) {
                let before = journal
                    .changes
                    .get(&update.path)
                    .map(|change| change.before.clone())
                    .unwrap_or_else(|| {
                        previous
                            .map(|file| file.content.clone())
                            .unwrap_or_default()
                    });
                journal.revision += 1;
                if before == content {
                    journal.changes.remove(&update.path);
                } else {
                    let kind = if journal
                        .changes
                        .get(&update.path)
                        .is_some_and(|change| change.kind == "added")
                        || (previous.is_none() && before.is_empty())
                    {
                        "added"
                    } else {
                        "modified"
                    };
                    journal.changes.insert(
                        update.path.clone(),
                        FileChange {
                            path: update.path.clone(),
                            before: before.clone(),
                            after: content.clone(),
                            kind: kind.into(),
                            revision: journal.revision,
                            hunks: hunks(&before, &content),
                        },
                    );
                }
            }
            journal.files.insert(
                update.path,
                TrackedFile {
                    version: update.version,
                    content,
                },
            );
        }
        if journal.initialized {
            let gone: Vec<_> = journal
                .files
                .keys()
                .filter(|path| !selected_set.contains(*path))
                .filter(|path| {
                    let absolute = if Path::new(path).is_absolute() {
                        PathBuf::from(path)
                    } else {
                        workspace.join(path)
                    };
                    std::fs::metadata(absolute)
                        .is_err_and(|error| error.kind() == std::io::ErrorKind::NotFound)
                })
                .cloned()
                .collect();
            for path in gone {
                let Some(previous) = journal.files.remove(&path) else {
                    continue;
                };
                journal.revision += 1;
                if journal
                    .changes
                    .get(&path)
                    .is_some_and(|change| change.kind == "added")
                {
                    journal.changes.remove(&path);
                } else {
                    let before = journal
                        .changes
                        .get(&path)
                        .map(|change| change.before.clone())
                        .unwrap_or(previous.content);
                    journal.changes.insert(
                        path.clone(),
                        FileChange {
                            path,
                            before: before.clone(),
                            after: String::new(),
                            kind: "deleted".into(),
                            revision: journal.revision,
                            hunks: hunks(&before, ""),
                        },
                    );
                }
            }
        }
        journal.files.retain(|path, _| selected_set.contains(path));
        while journal.changes.len() > MAX_FILES
            || journal
                .changes
                .values()
                .map(|change| change.before.len() + change.after.len())
                .sum::<usize>()
                > 2 * MAX_PROJECT_BYTES as usize
        {
            if let Some(oldest) = journal
                .changes
                .values()
                .min_by_key(|change| change.revision)
                .map(|change| change.path.clone())
            {
                journal.changes.remove(&oldest);
                limited = true;
            } else {
                break;
            }
        }
        if !journal.initialized || journal.limited != limited {
            journal.revision += 1;
        }
        journal.initialized = true;
        journal.limited = limited;
        let changes = if since == Some(journal.revision) {
            None
        } else {
            let mut changes: Vec<_> = journal.changes.values().cloned().collect();
            changes.sort_by(|a, b| a.path.cmp(&b.path));
            Some(changes)
        };
        Ok(ChangeSnapshot {
            revision: journal.revision,
            changes,
            limited,
        })
    }
    pub fn reviewed(
        &self,
        root: &str,
        project: &str,
        path: &str,
        revision: u64,
    ) -> Result<(), String> {
        let root = canonical_workspace(root)?;
        let project = resolve_project_path(&root, project)?;
        let mut journals = self
            .journals
            .lock()
            .map_err(|_| "File change journal unavailable")?;
        let journal = journals
            .get_mut(&project)
            .ok_or("Project change journal is not ready")?;
        let change = journal
            .changes
            .get(path)
            .ok_or("File change is no longer pending")?;
        if change.revision != revision {
            return Err(
                "This file changed again. Review the updated diff before marking it reviewed."
                    .into(),
            );
        }
        journal.changes.remove(path);
        journal.revision += 1;
        Ok(())
    }
}
fn hunks(before: &str, after: &str) -> Vec<ChangeHunk> {
    let diff = similar::TextDiff::configure()
        .timeout(std::time::Duration::from_millis(100))
        .diff_lines(before, after);
    diff.ops()
        .iter()
        .filter(|op| op.tag() != similar::DiffTag::Equal)
        .take(512)
        .map(|op| {
            let old = op.old_range();
            let new = op.new_range();
            ChangeHunk {
                old_start: old.start + 1,
                old_lines: old.len(),
                new_start: new.start + 1,
                new_lines: new.len(),
            }
        })
        .collect()
}
fn flatten(nodes: &[ProjectNode], files: &mut Vec<String>) {
    for node in nodes {
        if matches!(node.kind, NodeKind::Directory) {
            if let Some(children) = &node.children {
                flatten(children, files);
            }
        } else {
            files.push(node.path.clone());
        }
    }
}
fn tracked(path: &str) -> bool {
    let path = Path::new(path);
    if path.components().any(|part| {
        let value = part.as_os_str().to_string_lossy();
        value.starts_with('.')
            || matches!(
                value.as_ref(),
                "build" | "dist" | "out" | "node_modules" | "target" | "__pycache__"
            )
    }) {
        return false;
    }
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_lowercase();
    if name.starts_with('.')
        || matches!(
            name.as_str(),
            "credentials.json"
                | "auth.json"
                | "secrets.json"
                | "secrets.yaml"
                | "passwords.txt"
                | "private.key"
                | "id_rsa"
                | "id_ed25519"
        )
    {
        return false;
    }
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .unwrap_or_default()
            .to_lowercase()
            .as_str(),
        "v" | "sv"
            | "vh"
            | "svh"
            | "cst"
            | "sdc"
            | "tcl"
            | "ps1"
            | "psd1"
            | "py"
            | "md"
            | "txt"
            | "toml"
            | "json"
            | "yaml"
            | "yml"
            | "sh"
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn journal_tracks_unopened_files_and_accumulates_changes_until_reviewed() {
        let root = std::env::temp_dir().join(format!("tang-diff-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("rtl")).unwrap();
        std::fs::write(root.join("fpga.ps1"), "# fixture").unwrap();
        std::fs::write(root.join("fpga.config.psd1"), "@{}").unwrap();
        std::fs::write(root.join("rtl/top.sv"), "module old; endmodule").unwrap();
        let registry = ChangeRegistry::default();
        let root_ref = root.to_string_lossy();
        assert!(registry
            .poll(&root_ref, ".", None)
            .unwrap()
            .changes
            .unwrap()
            .is_empty());
        std::fs::write(root.join("rtl/top.sv"), "module first_edit; endmodule").unwrap();
        let first = registry
            .poll(&root_ref, ".", None)
            .unwrap()
            .changes
            .unwrap()
            .pop()
            .unwrap();
        std::fs::write(root.join("rtl/top.sv"), "module second_edit; endmodule").unwrap();
        let snapshot = registry.poll(&root_ref, ".", None).unwrap();
        let change = &snapshot.changes.as_ref().unwrap()[0];
        assert_eq!(change.before, "module old; endmodule");
        assert_eq!(change.after, "module second_edit; endmodule");
        assert!(registry
            .reviewed(&root_ref, ".", &first.path, first.revision)
            .is_err());
        registry
            .reviewed(&root_ref, ".", &change.path, change.revision)
            .unwrap();
        assert!(registry
            .poll(&root_ref, ".", None)
            .unwrap()
            .changes
            .unwrap()
            .is_empty());
        assert!(registry
            .poll(&root_ref, ".", Some(snapshot.revision))
            .unwrap()
            .changes
            .is_some());
        std::fs::write(root.join("rtl/new.sv"), "new file").unwrap();
        assert!(registry
            .poll(&root_ref, ".", None)
            .unwrap()
            .changes
            .unwrap()
            .iter()
            .any(|c| c.kind == "added"));
        std::fs::remove_file(root.join("rtl/top.sv")).unwrap();
        assert!(registry
            .poll(&root_ref, ".", None)
            .unwrap()
            .changes
            .unwrap()
            .iter()
            .any(|c| c.kind == "deleted"));
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(test)]
mod hunk_tests {
    use super::*;
    #[test]
    fn native_hunks_identify_separate_edits_and_skip_sensitive_files() {
        let edits = hunks("a\nb\nc\nd\ne\n", "a\nchanged\nc\nd\ninserted\ne\n");
        assert_eq!(edits.len(), 2);
        assert_eq!(edits[0].old_start, 2);
        assert_eq!(edits[0].new_start, 2);
        assert_eq!(edits[1].old_lines, 0);
        assert_eq!(edits[1].new_lines, 1);
        assert!(!tracked(".codex/auth.json"));
        assert!(!tracked("credentials.json"));
        assert!(!tracked("build/timing.json"));
        assert!(tracked("rtl/token_bucket.sv"));
        assert!(tracked("rtl/private_module.v"));
    }
}
