use crate::models::{NodeKind, ProjectNode, ProjectTemplate, TemplateCatalog, WorkspaceSnapshot};
use crate::security::{
    canonical_workspace, child_process_path, safe_existing_path, safe_file_path,
};
use chrono::Utc;
use regex::Regex;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Default, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceState {
    active_project: String,
    recent_projects: Vec<String>,
}

const IGNORED_DIRECTORIES: &[&str] = &[
    ".git",
    ".fpga-studio",
    "node_modules",
    "target",
    "__pycache__",
];
const MAX_TREE_ENTRIES: usize = 20_000;

pub fn discover_workspace() -> Result<PathBuf, String> {
    if let Ok(override_root) = std::env::var("FPGA_STUDIO_WORKSPACE") {
        return canonical_workspace(&override_root);
    }
    let start = std::env::current_dir()
        .map_err(|error| format!("Cannot read the working directory: {error}"))?;
    for candidate in start.ancestors() {
        if candidate.join("fpga.ps1").is_file() {
            return canonical_workspace(&candidate.to_string_lossy());
        }
    }
    let development_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    if development_root.join("fpga.ps1").is_file() {
        return canonical_workspace(&development_root.to_string_lossy());
    }
    Err("No FPGA Studio workspace was found. Set FPGA_STUDIO_WORKSPACE or open the app from a repository checkout.".into())
}

pub fn snapshot() -> Result<WorkspaceSnapshot, String> {
    let root = discover_workspace()?;
    let state = read_workspace_state(&root);
    let active = if state.active_project.is_empty() {
        "."
    } else {
        state.active_project.as_str()
    };
    snapshot_for(&root, active, state.recent_projects)
}

fn snapshot_for(
    root: &Path,
    project_path: &str,
    recent_projects: Vec<String>,
) -> Result<WorkspaceSnapshot, String> {
    let directory =
        safe_existing_path(root, project_path).or_else(|_| safe_existing_path(root, "."))?;
    let relative = directory
        .strip_prefix(root)
        .unwrap_or(Path::new("."))
        .to_string_lossy()
        .replace('\\', "/");
    let project_path = if relative.is_empty() {
        ".".to_owned()
    } else {
        relative
    };
    let mut seen = 0;
    let tree = list_directory(root, &directory, &mut seen)?;
    let project = project_display_name(&directory);
    Ok(WorkspaceSnapshot {
        root: child_process_path(root).to_string_lossy().into_owned(),
        project,
        project_path,
        tree,
        recent_projects,
    })
}

pub fn templates(root: &str) -> Result<Vec<ProjectTemplate>, String> {
    let root = canonical_workspace(root)?;
    let catalog_path = root.join("templates/catalog.json");
    let catalog: TemplateCatalog = serde_json::from_slice(
        &fs::read(&catalog_path)
            .map_err(|error| format!("Cannot read template catalog: {error}"))?,
    )
    .map_err(|error| format!("Template catalog is invalid: {error}"))?;
    if catalog.schema_version != 1 {
        return Err(format!(
            "Unsupported template catalog schema {}",
            catalog.schema_version
        ));
    }
    for template in &catalog.templates {
        validate_template_source(&root, &template.base)?;
        if let Some(overlay) = &template.overlay {
            validate_template_source(&root, overlay)?;
        }
    }
    Ok(catalog.templates)
}

pub fn create_project(
    root: &str,
    name: &str,
    template_id: &str,
    display_name: &str,
    board_id: &str,
) -> Result<WorkspaceSnapshot, String> {
    let root = canonical_workspace(root)?;
    let project_name = name.trim();
    let name_pattern = Regex::new(r"^\d{2}_[a-z][a-z0-9_]*$").expect("project name regex is valid");
    if !name_pattern.is_match(project_name) {
        return Err(
            "Use two digits, an underscore, and lowercase words, for example 04_spi_sensor".into(),
        );
    }
    let template = templates(&root.to_string_lossy())?
        .into_iter()
        .find(|item| item.id == template_id)
        .ok_or_else(|| format!("Unknown project template '{template_id}'"))?;
    let selected_board = if board_id.trim().is_empty() {
        "tang_primer_20k"
    } else {
        board_id.trim()
    };
    let supported_boards = if template.supported_boards.is_empty() {
        vec!["tang_primer_20k".to_owned()]
    } else {
        template.supported_boards.clone()
    };
    if !supported_boards.iter().any(|id| id == selected_board) {
        return Err(format!("The '{}' template is not hardware-ready for board '{}'. Choose a compatible template or the Primer 20K Dock.", template.name, selected_board));
    }
    let projects_root = root.join("projects");
    fs::create_dir_all(&projects_root)
        .map_err(|error| format!("Cannot create projects directory: {error}"))?;
    let target = projects_root.join(project_name);
    if target.exists() {
        return Err(format!("A project named '{project_name}' already exists"));
    }
    let base = validate_template_source(&root, &template.base)?;
    let result = (|| {
        fs::create_dir(&target)
            .map_err(|error| format!("Cannot create project folder: {error}"))?;
        copy_template_tree(&base, &target)?;
        if let Some(overlay) = &template.overlay {
            let overlay = validate_template_source(&root, overlay)?;
            copy_template_tree(&overlay, &target)?;
        }
        if selected_board != "tang_primer_20k" {
            configure_board(&root, &target, selected_board)?;
        }
        let title = if display_name.trim().is_empty() {
            template.name.as_str()
        } else {
            display_name.trim()
        };
        let manifest = serde_json::json!({
            "schemaVersion": 1,
            "name": title,
            "folder": project_name,
            "board": selected_board,
            "top": "top",
            "template": template.id,
            "createdAt": Utc::now().to_rfc3339(),
            "languages": ["systemverilog"],
            "sourceRoots": ["rtl"],
            "testRoots": ["sim"]
        });
        fs::write(
            target.join("fpga.project.json"),
            serde_json::to_string_pretty(&manifest)
                .map_err(|error| format!("Cannot serialize project manifest: {error}"))?
                + "\n",
        )
        .map_err(|error| format!("Cannot write project manifest: {error}"))?;
        let readme = target.join("README.md");
        if readme.is_file() && !display_name.trim().is_empty() {
            let existing = fs::read_to_string(&readme)
                .map_err(|error| format!("Cannot read template README: {error}"))?;
            let heading = Regex::new(r"(?m)^# .+$").expect("heading regex is valid");
            fs::write(
                &readme,
                heading
                    .replacen(&existing, 1, format!("# {}", display_name.trim()))
                    .as_bytes(),
            )
            .map_err(|error| format!("Cannot customize project README: {error}"))?;
        }
        Ok::<(), String>(())
    })();
    if let Err(error) = result {
        let _ = fs::remove_dir_all(&target);
        return Err(format!("Project creation was rolled back: {error}"));
    }
    let project_path = format!("projects/{project_name}");
    let mut state = read_workspace_state(&root);
    state.recent_projects.retain(|item| item != &project_path);
    state.recent_projects.insert(0, project_path.clone());
    state.recent_projects.truncate(12);
    state.active_project = project_path.clone();
    persist_workspace_state(&root, &state)?;
    snapshot_for(&root, &project_path, state.recent_projects)
}

fn configure_board(root: &Path, target: &Path, board_id: &str) -> Result<(), String> {
    let profile = crate::boards::list(&root.to_string_lossy())?
        .into_iter()
        .find(|item| item.id == board_id)
        .ok_or_else(|| format!("Unknown board package '{board_id}'"))?;
    let relative_constraint = profile
        .constraints
        .first()
        .ok_or("Board package has no constraints")?;
    let source = root
        .join("boards/gowin")
        .join(&profile.id)
        .join(relative_constraint);
    if !source.is_file() || !source.starts_with(root) {
        return Err(format!(
            "Board '{}' constraint package is incomplete",
            profile.name
        ));
    }
    let file_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("Board constraint filename is invalid")?;
    let destination_directory = target.join("constraints");
    fs::create_dir_all(&destination_directory)
        .map_err(|error| format!("Cannot create project constraints: {error}"))?;
    for entry in fs::read_dir(&destination_directory)
        .map_err(|error| format!("Cannot inspect generated constraints: {error}"))?
    {
        let path = entry
            .map_err(|error| format!("Cannot inspect generated constraint: {error}"))?
            .path();
        if path.is_file()
            && matches!(
                path.extension().and_then(|value| value.to_str()),
                Some("cst" | "sdc")
            )
        {
            fs::remove_file(&path)
                .map_err(|error| format!("Cannot replace generated constraints: {error}"))?;
        }
    }
    let package = root.join("boards/gowin").join(&profile.id);
    for relative in profile
        .constraints
        .iter()
        .chain(profile.timing_constraints.iter())
    {
        let constraint_source = package.join(relative);
        let constraint_name = constraint_source
            .file_name()
            .ok_or("Board constraint filename is invalid")?;
        fs::copy(
            &constraint_source,
            destination_directory.join(constraint_name),
        )
        .map_err(|error| format!("Cannot copy board constraints: {error}"))?;
    }

    let config_path = target.join("fpga.config.psd1");
    let mut config = fs::read_to_string(&config_path)
        .map_err(|error| format!("Cannot read generated board configuration: {error}"))?;
    let yosys_family = profile
        .yosys_family
        .as_deref()
        .ok_or_else(|| format!("Board '{}' has no Yosys family", profile.name))?;
    let build_backend = profile
        .build
        .as_ref()
        .map(|build| build.backend.as_str())
        .unwrap_or("oss-cad-suite");
    let gowin_device_name = profile
        .build
        .as_ref()
        .map(|build| build.device_name.as_str())
        .unwrap_or(profile.family.as_str());
    let gowin_device_code = profile
        .build
        .as_ref()
        .and_then(|build| build.device_code.as_deref())
        .unwrap_or("");
    let gowin_device_version = profile
        .build
        .as_ref()
        .and_then(|build| build.device_version.as_deref())
        .unwrap_or("");
    let timing_constraint = profile
        .timing_constraints
        .first()
        .and_then(|relative| Path::new(relative).file_name())
        .and_then(|name| name.to_str())
        .map(|name| format!("constraints/{name}"))
        .unwrap_or_default();
    for (key, value) in [
        ("Device", profile.device.as_str()),
        ("Family", profile.family.as_str()),
        ("YosysFamily", yosys_family),
        ("BuildBackend", build_backend),
        ("GowinDeviceName", gowin_device_name),
        ("GowinDeviceCode", gowin_device_code),
        ("GowinDeviceVersion", gowin_device_version),
        ("Constraint", &format!("constraints/{file_name}")),
        ("TimingConstraint", timing_constraint.as_str()),
        ("ProgrammerBoard", profile.programmer.board.as_str()),
    ] {
        let pattern =
            Regex::new(&format!(r"(?m)^(\s*{}\s*=\s*)'[^']*'", regex::escape(key))).unwrap();
        if pattern.is_match(&config) {
            config = pattern
                .replace(&config, format!("${{1}}'{value}'"))
                .into_owned();
        } else {
            let close = config
                .rfind('}')
                .ok_or("Generated configuration is not a PowerShell data file")?;
            config.insert_str(close, &format!("    {key} = '{value}'\n"));
        }
    }
    let frequency_mhz = profile
        .clocks
        .first()
        .map(|clock| clock.frequency_hz / 1_000_000)
        .ok_or("Board has no clock")?;
    let clock_pattern = Regex::new(r"(?m)^(\s*ClockMHz\s*=\s*)\d+(?:\.\d+)?").unwrap();
    if !clock_pattern.is_match(&config) {
        return Err("Generated configuration has no ClockMHz setting".into());
    }
    config = clock_pattern
        .replace(&config, format!("${{1}}{frequency_mhz}"))
        .into_owned();
    fs::write(config_path, config)
        .map_err(|error| format!("Cannot write generated board configuration: {error}"))
}

fn project_display_name(directory: &Path) -> String {
    let manifest = directory.join("fpga.project.json");
    if let Ok(content) = fs::read(&manifest) {
        if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&content) {
            if let Some(name) = value.get("name").and_then(serde_json::Value::as_str) {
                if !name.trim().is_empty() {
                    return name.trim().to_owned();
                }
            }
        }
    }
    directory
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("FPGA project")
        .to_owned()
}

fn read_workspace_state(root: &Path) -> WorkspaceState {
    let path = root.join(".fpga-studio/workspace-state.json");
    fs::read(&path)
        .ok()
        .and_then(|content| serde_json::from_slice(&content).ok())
        .unwrap_or_default()
}

fn persist_workspace_state(root: &Path, state: &WorkspaceState) -> Result<(), String> {
    let directory = root.join(".fpga-studio");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Cannot create local workspace settings: {error}"))?;
    let path = directory.join("workspace-state.json");
    let temporary = directory.join("workspace-state.json.tmp");
    let backup = directory.join("workspace-state.json.bak");
    fs::write(
        &temporary,
        serde_json::to_vec_pretty(state)
            .map_err(|error| format!("Cannot serialize workspace settings: {error}"))?,
    )
    .map_err(|error| format!("Cannot write workspace settings: {error}"))?;
    if path.is_file() {
        let _ = fs::remove_file(&backup);
        fs::rename(&path, &backup)
            .map_err(|error| format!("Cannot prepare workspace settings update: {error}"))?;
    }
    if let Err(error) = fs::rename(&temporary, &path) {
        if backup.is_file() {
            let _ = fs::rename(&backup, &path);
        }
        return Err(format!("Cannot publish workspace settings: {error}"));
    }
    if backup.is_file() {
        let _ = fs::remove_file(backup);
    }
    Ok(())
}

fn validate_template_source(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let source = safe_existing_path(root, relative)?;
    let projects = root.join("projects");
    let templates = root.join("templates");
    if !source.is_dir() || (!source.starts_with(&projects) && !source.starts_with(&templates)) {
        return Err(format!(
            "Template source is outside the allowed packages: {relative}"
        ));
    }
    Ok(source)
}

fn copy_template_tree(source: &Path, target: &Path) -> Result<(), String> {
    for entry in fs::read_dir(source)
        .map_err(|error| format!("Cannot list template {}: {error}", source.display()))?
    {
        let entry = entry.map_err(|error| format!("Cannot read template entry: {error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Cannot inspect template entry: {error}"))?;
        let name = entry.file_name();
        let name_text = name.to_string_lossy();
        if file_type.is_symlink() {
            return Err(format!(
                "Template symlinks are not allowed: {}",
                entry.path().display()
            ));
        }
        if file_type.is_dir()
            && ["build", "obj_dir", "__pycache__", ".fpga-studio"].contains(&name_text.as_ref())
        {
            continue;
        }
        let destination = target.join(&name);
        if file_type.is_dir() {
            fs::create_dir_all(&destination)
                .map_err(|error| format!("Cannot create template directory: {error}"))?;
            copy_template_tree(&entry.path(), &destination)?;
        } else if file_type.is_file()
            && !matches!(
                entry.path().extension().and_then(|value| value.to_str()),
                Some("pyc" | "vvp" | "vcd" | "fst" | "fs")
            )
        {
            fs::copy(entry.path(), destination)
                .map_err(|error| format!("Cannot copy template file: {error}"))?;
        }
    }
    Ok(())
}

fn list_directory(
    root: &Path,
    directory: &Path,
    seen: &mut usize,
) -> Result<Vec<ProjectNode>, String> {
    let mut entries = fs::read_dir(directory)
        .map_err(|error| format!("Cannot list {}: {error}", directory.display()))?
        .filter_map(Result::ok)
        .filter(|entry| {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            !(entry.path().is_dir() && IGNORED_DIRECTORIES.contains(&name.as_ref()))
                && name != "studio"
        })
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| {
        (
            !entry.path().is_dir(),
            entry.file_name().to_string_lossy().to_lowercase(),
        )
    });
    let mut nodes = Vec::new();
    for entry in entries {
        if *seen >= MAX_TREE_ENTRIES {
            break;
        }
        *seen += 1;
        let path = entry.path();
        let relative = path
            .strip_prefix(root)
            .map_err(|_| "Project tree escaped the workspace")?
            .to_string_lossy()
            .replace('\\', "/");
        let name = entry.file_name().to_string_lossy().into_owned();
        if path.is_dir() {
            let children = list_directory(root, &path, seen)?;
            nodes.push(ProjectNode {
                name,
                path: relative,
                kind: NodeKind::Directory,
                children: Some(children),
            });
        } else {
            nodes.push(ProjectNode {
                name,
                path: relative,
                kind: NodeKind::File,
                children: None,
            });
        }
    }
    Ok(nodes)
}

pub fn read_text(root: &str, relative: &str) -> Result<String, String> {
    let root = canonical_workspace(root)?;
    let file = safe_file_path(&root, relative)?;
    let metadata = fs::metadata(&file).map_err(|error| format!("Cannot inspect file: {error}"))?;
    if metadata.len() > 4 * 1024 * 1024 {
        return Err("Text files larger than 4 MiB are opened read-only by external tools".into());
    }
    fs::read_to_string(&file).map_err(|error| format!("Cannot read {}: {error}", file.display()))
}

pub fn write_text(root: &str, relative: &str, content: &str) -> Result<(), String> {
    if content.len() > 4 * 1024 * 1024 {
        return Err("Refusing to save a text buffer larger than 4 MiB".into());
    }
    let root = canonical_workspace(root)?;
    let file = safe_file_path(&root, relative)?;
    let suffix = file
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("txt");
    let temporary = file.with_extension(format!("{suffix}.{}.tmp", uuid::Uuid::new_v4()));
    fs::write(&temporary, content).map_err(|error| format!("Cannot stage file: {error}"))?;
    if !file.exists() {
        return fs::rename(&temporary, &file)
            .map_err(|error| format!("Cannot commit saved file: {error}"));
    }
    let backup = file.with_extension(format!("{suffix}.fpga-studio-backup"));
    if backup.exists() {
        fs::remove_file(&backup)
            .map_err(|error| format!("Cannot remove stale save backup: {error}"))?;
    }
    fs::rename(&file, &backup).map_err(|error| format!("Cannot stage existing file: {error}"))?;
    if let Err(error) = fs::rename(&temporary, &file) {
        let _ = fs::rename(&backup, &file);
        let _ = fs::remove_file(&temporary);
        return Err(format!(
            "Cannot commit saved file; the original was restored: {error}"
        ));
    }
    fs::remove_file(&backup).map_err(|error| {
        format!("File saved, but its temporary backup could not be removed: {error}")
    })
}

#[cfg(test)]
mod tests {
    use super::{configure_board, create_project};
    use std::fs;

    #[test]
    fn creates_transactional_project_from_catalog() {
        let root =
            std::env::temp_dir().join(format!("fpga-studio-project-test-{}", uuid::Uuid::new_v4()));
        let base = root.join("projects/_template");
        let overlay = root.join("templates/demo");
        fs::create_dir_all(base.join("rtl")).expect("base tree");
        fs::create_dir_all(base.join("build")).expect("generated tree");
        fs::create_dir_all(overlay.join("rtl")).expect("overlay tree");
        fs::write(root.join("fpga.ps1"), "# test").expect("workspace marker");
        fs::write(base.join("rtl/top.sv"), "module old; endmodule\n").expect("base source");
        fs::write(base.join("build/generated.bin"), "ignore").expect("generated file");
        fs::write(base.join("README.md"), "# Template\n").expect("readme");
        fs::write(overlay.join("rtl/top.sv"), "module top; endmodule\n").expect("overlay source");
        fs::write(
            root.join("templates/catalog.json"),
            r#"{
          "schemaVersion": 1,
          "templates": [{
            "id": "demo", "name": "Demo", "description": "Test", "level": "Beginner",
            "category": "Test", "base": "projects/_template", "overlay": "templates/demo",
            "hardwareReady": true, "tags": ["test"]
          }]
        }"#,
        )
        .expect("catalog");

        let result = create_project(
            &root.to_string_lossy(),
            "04_demo",
            "demo",
            "Demo project",
            "tang_primer_20k",
        )
        .expect("project creation should pass");
        assert_eq!(result.project_path, "projects/04_demo");
        assert!(root.join("projects/04_demo/fpga.project.json").is_file());
        assert!(root.join(".fpga-studio/workspace-state.json").is_file());
        assert_eq!(result.project, "Demo project");
        assert_eq!(
            fs::read_to_string(root.join("projects/04_demo/rtl/top.sv")).expect("created source"),
            "module top; endmodule\n"
        );
        assert!(!root.join("projects/04_demo/build").exists());
        assert!(create_project(
            &root.to_string_lossy(),
            "../escape",
            "demo",
            "",
            "tang_primer_20k"
        )
        .is_err());
        assert!(create_project(
            &root.to_string_lossy(),
            "04_demo",
            "demo",
            "",
            "tang_primer_20k"
        )
        .is_err());

        fs::remove_dir_all(&root).expect("temporary workspace cleanup");
    }

    #[test]
    fn applies_a_non_default_board_package_to_generated_configuration() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .unwrap();
        let target =
            std::env::temp_dir().join(format!("fpga-board-config-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("fpga.config.psd1"), "@{\n Device='old'\n Family='old'\n YosysFamily='old'\n Constraint='old.cst'\n ClockMHz=1\n ProgrammerBoard='old'\n}\n").unwrap();
        configure_board(&root, &target, "tang_nano_9k").expect("Nano 9K configuration");
        let config = fs::read_to_string(target.join("fpga.config.psd1")).unwrap();
        assert!(config.contains("GW1NR-LV9QN88PC6/I5"));
        assert!(config.contains("'tangnano9k'"));
        assert!(config.contains("constraints/tang_nano_9k.cst"));
        assert!(target.join("constraints/tang_nano_9k.cst").is_file());
        fs::remove_dir_all(target).unwrap();
    }

    #[test]
    fn applies_independent_console_device_and_constraint_packages() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .unwrap();
        for (board, device, family, backend, constraint, timing, programmer) in [
            (
                "tang_console_60k",
                "GW5AT-LV60PG484AC1/I0",
                "GW5AT-60B",
                "gowin-eda",
                "tang_console_60k.cst",
                "tang_console_60k.sdc",
                "tangconsole",
            ),
            (
                "tang_console_138k",
                "GW5AST-LV138PG484AC1/I0",
                "GW5AST-138C",
                "oss-cad-suite",
                "tang_console_138k.cst",
                "tang_console_138k.sdc",
                "tangmega138k",
            ),
        ] {
            let target = std::env::temp_dir().join(format!(
                "fpga-console-config-test-{}-{}",
                board,
                uuid::Uuid::new_v4()
            ));
            fs::create_dir_all(target.join("constraints")).unwrap();
            fs::write(target.join("constraints/old.cst"), "old").unwrap();
            fs::write(
                target.join("fpga.config.psd1"),
                "@{\n Device='old'\n Family='old'\n YosysFamily='old'\n Constraint='old.cst'\n ClockMHz=1\n ProgrammerBoard='old'\n}\n",
            )
            .unwrap();
            configure_board(&root, &target, board).expect("Console configuration");
            let config = fs::read_to_string(target.join("fpga.config.psd1")).unwrap();
            assert!(config.contains(device));
            assert!(config.contains(family));
            assert!(config.contains(&format!("BuildBackend = '{backend}'")));
            assert!(config.contains(constraint));
            assert!(config.contains(timing));
            assert!(config.contains(programmer));
            assert!(target.join("constraints").join(constraint).is_file());
            assert!(target.join("constraints").join(timing).is_file());
            assert!(!target.join("constraints/old.cst").exists());
            fs::remove_dir_all(target).unwrap();
        }
    }

    #[test]
    fn persists_and_reopens_each_console_board_selection() {
        let repository = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .unwrap();
        let root = std::env::temp_dir().join(format!(
            "fpga-console-persistence-test-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(root.join("projects/_template/rtl")).unwrap();
        fs::create_dir_all(root.join("projects/_template/constraints")).unwrap();
        fs::create_dir_all(root.join("templates")).unwrap();
        fs::create_dir_all(root.join("boards/gowin")).unwrap();
        fs::write(root.join("fpga.ps1"), "# workspace marker\n").unwrap();
        fs::write(
            root.join("projects/_template/rtl/top.sv"),
            "module top; endmodule\n",
        )
        .unwrap();
        fs::write(root.join("projects/_template/README.md"), "# Template\n").unwrap();
        fs::write(
            root.join("projects/_template/fpga.config.psd1"),
            "@{\n Device='old'\n Family='old'\n YosysFamily='old'\n BuildBackend='old'\n GowinDeviceName='old'\n GowinDeviceCode='old'\n GowinDeviceVersion='old'\n Constraint='old.cst'\n TimingConstraint=''\n ClockMHz=1\n ProgrammerBoard='old'\n}\n",
        )
        .unwrap();
        fs::write(
            root.join("templates/catalog.json"),
            r#"{
              "schemaVersion": 1,
              "templates": [{
                "id": "console", "name": "Console", "description": "Test",
                "level": "Beginner", "category": "Test", "base": "projects/_template",
                "hardwareReady": true, "supportedBoards": ["tang_console_60k", "tang_console_138k"],
                "tags": ["console"]
              }]
            }"#,
        )
        .unwrap();
        for board in ["tang_console_60k", "tang_console_138k"] {
            let source = repository.join("boards/gowin").join(board);
            let destination = root.join("boards/gowin").join(board);
            fs::create_dir_all(destination.join("constraints")).unwrap();
            fs::copy(source.join("board.json"), destination.join("board.json")).unwrap();
            for constraint in [format!("{board}.cst"), format!("{board}.sdc")] {
                fs::copy(
                    source.join("constraints").join(&constraint),
                    destination.join("constraints").join(constraint),
                )
                .unwrap();
            }
        }

        for (folder, board) in [
            ("04_console_60k", "tang_console_60k"),
            ("05_console_138k", "tang_console_138k"),
        ] {
            create_project(
                &root.to_string_lossy(),
                folder,
                "console",
                "Console project",
                board,
            )
            .expect("Console project creation");
            let manifest: serde_json::Value = serde_json::from_slice(
                &fs::read(root.join("projects").join(folder).join("fpga.project.json")).unwrap(),
            )
            .unwrap();
            assert_eq!(manifest["board"], board);
            let reopened =
                crate::boards::active(&root.to_string_lossy(), &format!("projects/{folder}"))
                    .expect("persisted board selection reopens");
            assert_eq!(reopened.id, board);
        }
        fs::remove_dir_all(root).unwrap();
    }
}
