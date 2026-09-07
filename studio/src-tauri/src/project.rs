use crate::models::{
    CustomProjectRequest, FpgaTarget, NodeKind, ProjectNode, ProjectReplaceSummary,
    ProjectSearchMatch, ProjectTemplate, TemplateCatalog, WorkspaceSnapshot,
};
use crate::security::{
    canonical_workspace, child_process_path, resolve_project_path, safe_existing_path,
    safe_file_path, workspace_path_reference,
};
use chrono::Utc;
use regex::{NoExpand, Regex, RegexBuilder};
use std::fs;
use std::fs::OpenOptions;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

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
const PROJECT_AGENT_GUIDE: &str = include_str!("../../../projects/AGENTS.md");
static FILE_WRITE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

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

pub fn open_project(root: &str, project_path: &str) -> Result<WorkspaceSnapshot, String> {
    let root = canonical_workspace(root)?;
    let directory = resolve_project_path(&root, project_path)?;
    let relative = workspace_path_reference(&root, &directory);
    let mut state = read_workspace_state(&root);
    state.recent_projects.retain(|item| item != &relative);
    state.recent_projects.insert(0, relative.clone());
    state.recent_projects.truncate(12);
    state.active_project = relative.clone();
    persist_workspace_state(&root, &state)?;
    snapshot_for(&root, &relative, state.recent_projects)
}

fn snapshot_for(
    root: &Path,
    project_path: &str,
    recent_projects: Vec<String>,
) -> Result<WorkspaceSnapshot, String> {
    let directory =
        resolve_project_path(root, project_path).or_else(|_| resolve_project_path(root, "."))?;
    let project_path = workspace_path_reference(root, &directory);
    let mut seen = 0;
    let tree = list_directory(root, &directory, &directory, &mut seen)?;
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
    location: &str,
    template_id: &str,
    display_name: &str,
    board_id: &str,
) -> Result<WorkspaceSnapshot, String> {
    let root = canonical_workspace(root)?;
    let project_name = validate_project_name(name)?;
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
    let (target, project_path) = project_target(&root, &project_name, location)?;
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
        configure_board(&root, &target, selected_board)?;
        let profile = crate::boards::list(&root.to_string_lossy())?
            .into_iter()
            .find(|item| item.id == selected_board)
            .ok_or_else(|| format!("Unknown board package '{selected_board}'"))?;
        let target_profile = fpga_target(&profile);
        let title = if display_name.trim().is_empty() {
            template.name.as_str()
        } else {
            display_name.trim()
        };
        let manifest = serde_json::json!({
            "schemaVersion": 2,
            "name": title,
            "folder": &project_name,
            "mode": "template",
            "board": {
                "id": selected_board,
                "name": profile.name,
                "manufacturer": "Sipeed",
                "targetDevice": profile.device
            },
            "target": target_profile,
            "top": "top",
            "template": template.id,
            "clock": {
                "signal": profile.clocks.first().map(|clock| clock.name.as_str()).unwrap_or("clk"),
                "frequencyHz": profile.clocks.first().map(|clock| clock.frequency_hz).unwrap_or(0)
            },
            "constraints": profile.constraints.iter().filter_map(|path| Path::new(path).file_name()).map(|name| format!("constraints/{}", name.to_string_lossy())).collect::<Vec<_>>(),
            "timingConstraints": profile.timing_constraints.iter().filter_map(|path| Path::new(path).file_name()).map(|name| format!("constraints/{}", name.to_string_lossy())).collect::<Vec<_>>(),
            "toolchain": profile.build.as_ref().map(|build| build.backend.as_str()).unwrap_or("oss-cad-suite"),
            "programmer": profile.programmer.board,
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
        install_agent_guide(&target)?;
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
    let mut state = read_workspace_state(&root);
    state.recent_projects.retain(|item| item != &project_path);
    state.recent_projects.insert(0, project_path.clone());
    state.recent_projects.truncate(12);
    state.active_project = project_path.clone();
    persist_workspace_state(&root, &state)?;
    snapshot_for(&root, &project_path, state.recent_projects)
}

pub fn create_custom_project(
    root: &str,
    name: &str,
    location: &str,
    request: CustomProjectRequest,
) -> Result<WorkspaceSnapshot, String> {
    let root = canonical_workspace(root)?;
    let project_name = validate_project_name(name)?;
    let profile = crate::boards::list(&root.to_string_lossy())?
        .into_iter()
        .find(|item| item.id == request.board_id)
        .ok_or_else(|| format!("Unknown board package '{}'", request.board_id))?;
    validate_custom_request(&profile, &request)?;

    let (target, project_path) = project_target(&root, &project_name, location)?;
    if target.exists() {
        return Err(format!("A project named '{project_name}' already exists"));
    }
    let base = validate_template_source(&root, "projects/_template")?;
    let result = (|| {
        fs::create_dir(&target)
            .map_err(|error| format!("Cannot create project folder: {error}"))?;
        copy_template_tree(&base, &target)?;
        configure_board(&root, &target, &request.board_id)?;
        customize_generated_project(&target, &profile, &request)?;
        generate_custom_scaffold(&target, &request)?;

        let manifest = serde_json::json!({
            "schemaVersion": 2,
            "name": request.display_name.trim(),
            "folder": project_name,
            "mode": "custom",
            "board": {
                "id": profile.id,
                "name": profile.name,
                "manufacturer": "Sipeed",
                "targetDevice": profile.device
            },
            "target": request.target,
            "top": request.top,
            "template": serde_json::Value::Null,
            "clock": {
                "signal": request.clock_signal,
                "frequencyHz": (request.clock_mhz * 1_000_000.0).round() as u64
            },
            "constraints": [request.constraint_path],
            "timingConstraints": request.timing_constraint_path.iter().collect::<Vec<_>>(),
            "toolchain": request.toolchain,
            "programmer": request.programmer,
            "createdAt": Utc::now().to_rfc3339(),
            "languages": ["systemverilog", "verilog"],
            "sourceRoots": request.source_roots,
            "testRoots": request.test_roots
        });
        fs::write(
            target.join("fpga.project.json"),
            serde_json::to_string_pretty(&manifest)
                .map_err(|error| format!("Cannot serialize project manifest: {error}"))?
                + "\n",
        )
        .map_err(|error| format!("Cannot write project manifest: {error}"))?;
        install_agent_guide(&target)?;
        Ok::<(), String>(())
    })();
    if let Err(error) = result {
        let _ = fs::remove_dir_all(&target);
        return Err(format!("Custom project creation was rolled back: {error}"));
    }
    open_project(&root.to_string_lossy(), &project_path)
}

fn install_agent_guide(target: &Path) -> Result<(), String> {
    fs::write(target.join("AGENTS.md"), PROJECT_AGENT_GUIDE)
        .map_err(|error| format!("Cannot install AI development guidance: {error}"))
}

fn validate_project_name(name: &str) -> Result<String, String> {
    let project_name = name.trim();
    if project_name.is_empty() || project_name.chars().count() > 80 {
        return Err("Project name must contain between 1 and 80 characters".into());
    }
    if project_name.starts_with('.')
        || project_name.ends_with(['.', ' '])
        || project_name
            .chars()
            .any(|character| character.is_control() || r#"<>:\"/\\|?*"#.contains(character))
    {
        return Err(
            "Project name cannot start with '.', end with a dot or space, or contain < > : \" / \\ | ? *".into(),
        );
    }
    let stem = project_name
        .split('.')
        .next()
        .unwrap_or(project_name)
        .to_ascii_uppercase();
    let reserved = ["CON", "PRN", "AUX", "NUL"];
    let reserved_port = stem
        .strip_prefix("COM")
        .or_else(|| stem.strip_prefix("LPT"))
        .is_some_and(|suffix| {
            matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
        });
    if reserved.contains(&stem.as_str()) || reserved_port {
        return Err(format!("'{project_name}' is a reserved system folder name"));
    }
    Ok(project_name.into())
}

fn project_target(root: &Path, name: &str, location: &str) -> Result<(PathBuf, String), String> {
    let requested = if location.trim().is_empty() {
        let default = root.join("projects");
        fs::create_dir_all(&default)
            .map_err(|error| format!("Cannot create default projects directory: {error}"))?;
        default
    } else {
        PathBuf::from(location.trim())
    };
    let parent = fs::canonicalize(&requested)
        .map_err(|error| format!("Selected project location is unavailable: {error}"))?;
    if !parent.is_dir() {
        return Err("Selected project location is not a folder".into());
    }
    let target = parent.join(name);
    let project_path = workspace_path_reference(root, &target);
    Ok((target, project_path))
}

fn fpga_target(profile: &crate::models::BoardProfile) -> FpgaTarget {
    let package_pattern = Regex::new(r"(?:PG|QN|UG|BG|CS|FN)\d+[A-Z]?").expect("package regex");
    let (package, speed_grade) = package_pattern
        .find(&profile.device)
        .map(|value| {
            (
                value.as_str().to_owned(),
                profile.device[value.end()..].to_owned(),
            )
        })
        .unwrap_or_else(|| ("registered-board-package".into(), "profile-defined".into()));
    FpgaTarget {
        vendor: profile.vendor.clone(),
        family: profile.family.clone(),
        device: profile.device.clone(),
        package,
        speed_grade,
    }
}

fn validate_relative_project_path(path: &str, extension: &str) -> Result<(), String> {
    let normalized = path.replace('\\', "/");
    let candidate = Path::new(&normalized);
    if candidate.is_absolute()
        || normalized.starts_with('/')
        || normalized
            .split('/')
            .any(|part| part == ".." || part.is_empty())
        || !normalized.starts_with("constraints/")
        || candidate.extension().and_then(|value| value.to_str()) != Some(extension)
    {
        return Err(format!(
            "Use a project-relative constraints/{extension} path without '..' segments"
        ));
    }
    Ok(())
}

fn validate_custom_request(
    profile: &crate::models::BoardProfile,
    request: &CustomProjectRequest,
) -> Result<(), String> {
    let expected_target = fpga_target(profile);
    if request.target.vendor != expected_target.vendor
        || request.target.family != expected_target.family
        || request.target.device != expected_target.device
        || request.target.package != expected_target.package
        || request.target.speed_grade != expected_target.speed_grade
    {
        return Err("The FPGA target does not match the selected registered board package".into());
    }
    let identifier = Regex::new(r"^[A-Za-z_]\w*$").expect("HDL identifier regex");
    if !identifier.is_match(request.top.trim()) || !identifier.is_match(request.clock_signal.trim())
    {
        return Err("Top module and clock signal must be valid HDL identifiers".into());
    }
    let board_clock = profile
        .clocks
        .first()
        .ok_or("The selected board has no registered clock")?;
    if request.clock_signal != board_clock.name {
        return Err(format!(
            "The '{}' board package constrains clock signal '{}'; custom pin renaming is not supported yet",
            profile.name, board_clock.name
        ));
    }
    if !request.clock_mhz.is_finite() || request.clock_mhz < 0.1 || request.clock_mhz > 1000.0 {
        return Err("Clock target must be between 0.1 MHz and 1000 MHz".into());
    }
    let expected_toolchain = profile
        .build
        .as_ref()
        .map(|build| build.backend.as_str())
        .unwrap_or("oss-cad-suite");
    if request.toolchain != expected_toolchain || request.programmer != profile.programmer.board {
        return Err(
            "Toolchain and programmer must match a supported registered board route".into(),
        );
    }
    if request.source_roots != ["rtl"] || request.test_roots != ["sim"] {
        return Err("This release supports portable rtl/ and sim/ source roots only".into());
    }
    validate_relative_project_path(&request.constraint_path, "cst")?;
    if let Some(timing) = request.timing_constraint_path.as_deref() {
        validate_relative_project_path(timing, "sdc")?;
        if profile.timing_constraints.is_empty() {
            return Err(
                "The selected board package does not provide a timing constraint file".into(),
            );
        }
    }
    Ok(())
}

fn customize_generated_project(
    target: &Path,
    profile: &crate::models::BoardProfile,
    request: &CustomProjectRequest,
) -> Result<(), String> {
    let config_path = target.join("fpga.config.psd1");
    let mut config = fs::read_to_string(&config_path)
        .map_err(|error| format!("Cannot read generated configuration: {error}"))?;
    config = replace_config_string(&config, "Top", request.top.trim())?;
    config = replace_config_number(&config, "ClockMHz", request.clock_mhz)?;

    let source_constraint = profile
        .constraints
        .first()
        .and_then(|path| Path::new(path).file_name())
        .ok_or("Board package has no primary constraint")?;
    move_generated_constraint(target, source_constraint, &request.constraint_path)?;
    config = replace_config_string(&config, "Constraint", &request.constraint_path)?;

    let timing_value = if let Some(requested) = request.timing_constraint_path.as_deref() {
        let source = profile
            .timing_constraints
            .first()
            .and_then(|path| Path::new(path).file_name())
            .ok_or("Board package has no timing constraint")?;
        move_generated_constraint(target, source, requested)?;
        requested
    } else {
        ""
    };
    config = replace_config_string(&config, "TimingConstraint", timing_value)?;
    fs::write(&config_path, config)
        .map_err(|error| format!("Cannot save custom project configuration: {error}"))?;

    Ok(())
}

fn generate_custom_scaffold(target: &Path, request: &CustomProjectRequest) -> Result<(), String> {
    let constraint = fs::read_to_string(target.join(&request.constraint_path))
        .map_err(|error| format!("Cannot read custom constraint scaffold: {error}"))?;
    let led_pattern =
        Regex::new(r#"(?m)IO_LOC\s+"led_n(?:\[(\d+)\])?""#).expect("LED constraint regex");
    let mut led_width = 0usize;
    for captures in led_pattern.captures_iter(&constraint) {
        led_width = led_width.max(
            captures
                .get(1)
                .and_then(|value| value.as_str().parse::<usize>().ok())
                .unwrap_or(0)
                + 1,
        );
    }
    if led_width == 0 {
        return Err(
            "The selected board package has no led_n output for the portable starter".into(),
        );
    }
    let led_declaration = if led_width == 1 {
        "output logic led_n".to_owned()
    } else {
        format!("output logic [{}:0] led_n", led_width - 1)
    };
    let rtl = format!(
        "`timescale 1ns/1ps\n`default_nettype none\n\n// Portable custom-project starter generated from the selected board package.\nmodule {} (\n    input  logic {},\n    {}\n);\n    logic [23:0] counter = '0;\n\n    always_ff @(posedge {})\n        counter <= counter + 1'b1;\n\n    always_comb begin\n        led_n = '1;\n        led_n[0] = ~counter[23];\n    end\nendmodule\n\n`default_nettype wire\n",
        request.top, request.clock_signal, led_declaration, request.clock_signal
    );
    let testbench = format!(
        "`timescale 1ns/1ps\n`default_nettype none\n\nmodule tb_top;\n    logic {} = 1'b0;\n    logic [{}:0] led_n;\n\n    {} dut (.*);\n    always #5 {} = ~{};\n\n    initial begin\n        $dumpfile(\"build/waves.vcd\");\n        $dumpvars(0, tb_top);\n        repeat (4) @(posedge {});\n        if (^dut.counter === 1'bx) $fatal(1, \"counter contains an unknown value\");\n        $display(\"PASS: custom project scaffold is running\");\n        $finish;\n    end\nendmodule\n\n`default_nettype wire\n",
        request.clock_signal,
        led_width - 1,
        request.top,
        request.clock_signal,
        request.clock_signal,
        request.clock_signal
    );
    fs::write(target.join("rtl/top.sv"), rtl)
        .map_err(|error| format!("Cannot create custom RTL scaffold: {error}"))?;
    fs::write(target.join("sim/tb_top.sv"), testbench)
        .map_err(|error| format!("Cannot create custom simulation scaffold: {error}"))
}

fn move_generated_constraint(
    target: &Path,
    source_name: &std::ffi::OsStr,
    destination: &str,
) -> Result<(), String> {
    let source = target.join("constraints").join(source_name);
    let destination_path = target.join(destination);
    if source != destination_path {
        if let Some(parent) = destination_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Cannot create custom constraint directory: {error}"))?;
        }
        fs::rename(&source, &destination_path)
            .map_err(|error| format!("Cannot set custom constraint path: {error}"))?;
    }
    Ok(())
}

fn replace_config_string(config: &str, key: &str, value: &str) -> Result<String, String> {
    let pattern = Regex::new(&format!(r"(?m)^(\s*{}\s*=\s*)'[^']*'", regex::escape(key)))
        .expect("configuration key regex");
    if !pattern.is_match(config) {
        return Err(format!("Generated configuration has no {key} setting"));
    }
    Ok(pattern
        .replace(config, format!("${{1}}'{value}'"))
        .into_owned())
}

fn replace_config_number(config: &str, key: &str, value: f64) -> Result<String, String> {
    let pattern = Regex::new(&format!(
        r"(?m)^(\s*{}\s*=\s*)\d+(?:\.\d+)?",
        regex::escape(key)
    ))
    .expect("numeric configuration key regex");
    if !pattern.is_match(config) {
        return Err(format!("Generated configuration has no {key} setting"));
    }
    Ok(pattern
        .replace(config, format!("${{1}}{value}"))
        .into_owned())
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
    workspace: &Path,
    project_root: &Path,
    directory: &Path,
    seen: &mut usize,
) -> Result<Vec<ProjectNode>, String> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(directory)
        .map_err(|error| format!("Cannot list {}: {error}", directory.display()))?
    {
        let entry = entry.map_err(|error| format!("Cannot read a project entry: {error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Cannot inspect a project entry: {error}"))?;
        if file_type.is_symlink() {
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name == "studio" || (file_type.is_dir() && IGNORED_DIRECTORIES.contains(&name.as_ref()))
        {
            continue;
        }
        entries.push((entry, file_type));
    }
    entries.sort_by_key(|(entry, file_type)| {
        (
            !file_type.is_dir(),
            entry.file_name().to_string_lossy().to_lowercase(),
        )
    });
    let mut nodes = Vec::new();
    for (entry, file_type) in entries {
        if *seen >= MAX_TREE_ENTRIES {
            break;
        }
        *seen += 1;
        let path = entry.path();
        let resolved = fs::canonicalize(&path)
            .map_err(|error| format!("Cannot resolve project entry: {error}"))?;
        if !resolved.starts_with(project_root) {
            continue;
        }
        let relative = workspace_path_reference(workspace, &path);
        let name = entry.file_name().to_string_lossy().into_owned();
        if file_type.is_dir() {
            let children = list_directory(workspace, project_root, &path, seen)?;
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

fn save_backup_path(file: &Path) -> PathBuf {
    let suffix = file
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("txt");
    file.with_extension(format!("{suffix}.fpga-studio-backup"))
}

fn recover_interrupted_save(file: &Path) -> Result<(), String> {
    let backup = save_backup_path(file);
    if !file.exists() && backup.is_file() {
        fs::rename(&backup, file)
            .map_err(|error| format!("Cannot recover the interrupted file save: {error}"))?;
    }
    Ok(())
}

fn editable_file_path(workspace: &Path, reference: &str) -> Result<PathBuf, String> {
    let requested = Path::new(reference);
    if !requested.is_absolute() {
        return safe_file_path(workspace, reference);
    }
    let file_name = requested.file_name().ok_or("Selected file has no name")?;
    let parent = requested.parent().ok_or("Selected file has no parent")?;
    let candidate = fs::canonicalize(parent)
        .map_err(|error| format!("File directory is unavailable: {error}"))?
        .join(file_name);
    let state = read_workspace_state(workspace);
    for project_reference in std::iter::once(state.active_project.as_str())
        .chain(state.recent_projects.iter().map(String::as_str))
    {
        if !Path::new(project_reference).is_absolute() {
            continue;
        }
        let Ok(project) = resolve_project_path(workspace, project_reference) else {
            continue;
        };
        let Ok(relative) = candidate.strip_prefix(&project) else {
            continue;
        };
        return safe_file_path(&project, &relative.to_string_lossy());
    }
    Err("The selected file is outside the active FPGA project".into())
}

pub fn read_text(root: &str, relative: &str) -> Result<String, String> {
    let root = canonical_workspace(root)?;
    let file = editable_file_path(&root, relative)?;
    recover_interrupted_save(&file)?;
    let metadata = fs::metadata(&file).map_err(|error| format!("Cannot inspect file: {error}"))?;
    if metadata.len() > 4 * 1024 * 1024 {
        return Err("Text files larger than 4 MiB are opened read-only by external tools".into());
    }
    fs::read_to_string(&file).map_err(|error| format!("Cannot read {}: {error}", file.display()))
}

pub fn search_text(
    root: &str,
    project: &str,
    query: &str,
) -> Result<Vec<ProjectSearchMatch>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    if query.chars().count() > 120 {
        return Err("Project search terms are limited to 120 characters".into());
    }
    let root = canonical_workspace(root)?;
    let project = resolve_project_path(&root, project)?;
    let mut paths = Vec::new();
    collect_search_files(&project, &mut paths)?;
    if paths.len() > 2_000 {
        paths.truncate(2_000);
    }
    let needle = query.to_lowercase();
    let mut matches = Vec::new();
    for path in paths {
        let metadata =
            fs::metadata(&path).map_err(|error| format!("Cannot inspect search file: {error}"))?;
        if metadata.len() > 2 * 1024 * 1024 {
            continue;
        }
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        for (line_index, line) in content.lines().enumerate() {
            let lower = line.to_lowercase();
            let Some(byte_column) = lower.find(&needle) else {
                continue;
            };
            let column = original_column_for_folded_byte(line, byte_column);
            let preview: String = line.trim().chars().take(240).collect();
            matches.push(ProjectSearchMatch {
                file: workspace_path_reference(&root, &path),
                line: line_index as u32 + 1,
                column,
                preview,
            });
            if matches.len() >= 500 {
                return Ok(matches);
            }
        }
    }
    Ok(matches)
}

pub fn replace_text(
    root: &str,
    project: &str,
    query: &str,
    replacement: &str,
) -> Result<ProjectReplaceSummary, String> {
    let query = query.trim();
    if query.is_empty() {
        return Err("Enter text to replace".into());
    }
    if query.chars().count() > 120 {
        return Err("Search terms are limited to 120 characters".into());
    }
    if replacement.len() > 64 * 1024 {
        return Err("Replacement text is limited to 64 KiB".into());
    }
    let root = canonical_workspace(root)?;
    let project = resolve_project_path(&root, project)?;
    let matcher = RegexBuilder::new(&regex::escape(query))
        .case_insensitive(true)
        .build()
        .map_err(|error| format!("Cannot prepare replacement: {error}"))?;
    let mut paths = Vec::new();
    collect_search_files(&project, &mut paths)?;
    if paths.len() > 2_000 {
        paths.truncate(2_000);
    }
    let mut changes = Vec::new();
    let mut replacements = 0;
    for path in paths {
        let metadata = fs::metadata(&path)
            .map_err(|error| format!("Cannot inspect replacement file: {error}"))?;
        if metadata.len() > 2 * 1024 * 1024 {
            continue;
        }
        let Ok(original) = fs::read_to_string(&path) else {
            continue;
        };
        let count = matcher.find_iter(&original).count();
        if count == 0 {
            continue;
        }
        let updated = matcher
            .replace_all(&original, NoExpand(replacement))
            .into_owned();
        let relative = workspace_path_reference(&root, &path);
        replacements += count;
        changes.push((relative, original, updated));
    }

    let _write_guard = FILE_WRITE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut completed: Vec<usize> = Vec::new();
    for (index, (relative, _original, updated)) in changes.iter().enumerate() {
        if let Err(error) = write_text_unlocked(&root, relative, updated) {
            let mut rollback_failed = false;
            completed.push(index);
            for rollback_index in completed.into_iter().rev() {
                let (rollback_path, rollback_content, _) = &changes[rollback_index];
                rollback_failed |=
                    write_text_unlocked(&root, rollback_path, rollback_content).is_err();
            }
            return Err(if rollback_failed {
                format!("Replacement stopped at {relative}: {error}. Some rollback writes also failed; inspect the affected files before continuing")
            } else {
                format!("Replacement was rolled back after {relative} could not be saved: {error}")
            });
        }
        completed.push(index);
    }
    Ok(ProjectReplaceSummary {
        files_changed: changes.len(),
        replacements,
        files: changes.into_iter().map(|(path, _, _)| path).collect(),
    })
}

pub fn create_entry(
    root: &str,
    project: &str,
    relative: &str,
    directory: bool,
) -> Result<String, String> {
    let root = canonical_workspace(root)?;
    let project = resolve_project_path(&root, project)?;
    let normalized = relative.trim().replace('\\', "/");
    let entry = Path::new(&normalized);
    if normalized.is_empty()
        || entry.is_absolute()
        || entry
            .components()
            .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        return Err("Use a project-relative path without '.' or '..' segments".into());
    }
    let target = project.join(entry);
    let parent = target.parent().ok_or("New project entry has no parent")?;
    let parent = fs::canonicalize(parent)
        .map_err(|error| format!("Parent folder is unavailable: {error}"))?;
    if !parent.starts_with(&project) {
        return Err("New project entry escaped the active project".into());
    }
    if target.exists() {
        return Err(format!("'{}' already exists", normalized));
    }
    let workspace_relative = workspace_path_reference(&root, &target);
    if directory {
        fs::create_dir(&target).map_err(|error| format!("Cannot create folder: {error}"))?;
    } else {
        safe_file_path(&project, &normalized)?;
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
            .map_err(|error| format!("Cannot create file: {error}"))?;
    }
    Ok(workspace_relative)
}

fn original_column_for_folded_byte(line: &str, folded_byte: usize) -> u32 {
    let mut folded_cursor = 0;
    for (index, character) in line.chars().enumerate() {
        let folded_len = character.to_lowercase().map(char::len_utf8).sum::<usize>();
        if folded_byte < folded_cursor + folded_len {
            return index as u32 + 1;
        }
        folded_cursor += folded_len;
    }
    line.chars().count() as u32 + 1
}

fn collect_search_files(directory: &Path, paths: &mut Vec<PathBuf>) -> Result<(), String> {
    for entry in fs::read_dir(directory)
        .map_err(|error| format!("Cannot scan project search files: {error}"))?
    {
        let entry =
            entry.map_err(|error| format!("Cannot inspect project search entry: {error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Cannot inspect project search file: {error}"))?;
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        if file_type.is_dir() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if IGNORED_DIRECTORIES.contains(&name.as_ref())
                || ["build", "obj_dir"].contains(&name.as_ref())
            {
                continue;
            }
            collect_search_files(&path, paths)?;
        } else if file_type.is_file()
            && matches!(
                path.extension()
                    .and_then(|value| value.to_str())
                    .map(str::to_ascii_lowercase)
                    .as_deref(),
                Some(
                    "v" | "sv"
                        | "vh"
                        | "svh"
                        | "vhd"
                        | "vhdl"
                        | "cst"
                        | "sdc"
                        | "json"
                        | "jsonc"
                        | "psd1"
                        | "md"
                        | "txt"
                        | "toml"
                        | "yml"
                        | "yaml"
                        | "ps1"
                        | "tcl"
                        | "gtkw"
                        | "py"
                        | "rs"
                        | "ts"
                        | "tsx"
                        | "js"
                        | "jsx"
                        | "css"
                        | "html"
                        | "htm"
                        | "sh"
                        | "bat"
                        | "cmd"
                )
            )
        {
            paths.push(path);
        }
    }
    Ok(())
}

pub fn write_text(root: &str, relative: &str, content: &str) -> Result<(), String> {
    if content.len() > 4 * 1024 * 1024 {
        return Err("Refusing to save a text buffer larger than 4 MiB".into());
    }
    let _write_guard = FILE_WRITE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let root = canonical_workspace(root)?;
    write_text_unlocked(&root, relative, content)
}

fn write_text_unlocked(root: &Path, relative: &str, content: &str) -> Result<(), String> {
    if content.len() > 4 * 1024 * 1024 {
        return Err("Refusing to save a text buffer larger than 4 MiB".into());
    }
    let file = editable_file_path(root, relative)?;
    recover_interrupted_save(&file)?;
    let suffix = file
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("txt");
    let temporary = file.with_extension(format!("{suffix}.{}.tmp", uuid::Uuid::new_v4()));
    fs::write(&temporary, content).map_err(|error| format!("Cannot stage file: {error}"))?;
    if !file.exists() {
        return fs::rename(&temporary, &file).map_err(|error| {
            let _ = fs::remove_file(&temporary);
            format!("Cannot commit saved file: {error}")
        });
    }
    let backup = save_backup_path(&file);
    if backup.exists() {
        if let Err(error) = fs::remove_file(&backup) {
            let _ = fs::remove_file(&temporary);
            return Err(format!("Cannot remove stale save backup: {error}"));
        }
    }
    if let Err(error) = fs::rename(&file, &backup) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("Cannot stage existing file: {error}"));
    }
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
    use super::{
        configure_board, copy_template_tree, create_custom_project, create_entry, create_project,
        fpga_target, open_project, project_target, read_text, replace_text, save_backup_path,
        search_text, validate_project_name, write_text,
    };
    use crate::models::CustomProjectRequest;
    use std::fs;
    use std::path::Path;

    #[test]
    fn accepts_friendly_project_names_and_rejects_unsafe_folder_names() {
        for name in ["UART Terminal v1", "beginner-led", "控制器_lab"] {
            assert_eq!(validate_project_name(name).unwrap(), name);
        }
        for name in ["", "../escape", "bad/name", "CON", ".hidden", "trailing."] {
            assert!(
                validate_project_name(name).is_err(),
                "{name} must be rejected"
            );
        }
    }

    #[test]
    fn selected_project_location_can_be_outside_the_workspace() {
        let root = std::env::temp_dir().join(format!(
            "fpga-project-location-test-{}",
            uuid::Uuid::new_v4()
        ));
        let inside = root.join("My Labs");
        let outside = std::env::temp_dir().join(format!(
            "fpga-project-outside-test-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&inside).unwrap();
        fs::create_dir_all(&outside).unwrap();
        let canonical_root = fs::canonicalize(&root).unwrap();

        let (_, relative) =
            project_target(&canonical_root, "UART Project", &inside.to_string_lossy()).unwrap();
        assert_eq!(relative.replace('\\', "/"), "My Labs/UART Project");
        let (outside_target, outside_reference) =
            project_target(&canonical_root, "UART Project", &outside.to_string_lossy()).unwrap();
        assert_eq!(
            outside_target,
            fs::canonicalize(&outside).unwrap().join("UART Project")
        );
        assert!(Path::new(&outside_reference).is_absolute());

        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[test]
    fn creates_entries_and_replaces_project_text_without_interpreting_dollar_signs() {
        let root = std::env::temp_dir().join(format!(
            "fpga-explorer-actions-test-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(root.join("project/rtl")).unwrap();
        fs::write(root.join("fpga.ps1"), "# workspace marker\n").unwrap();
        fs::write(root.join("project/fpga.config.psd1"), "@{ Top='top' }\n").unwrap();
        fs::write(
            root.join("project/rtl/top.sv"),
            "logic signal; // SIGNAL signal\n",
        )
        .unwrap();

        let created = create_entry(
            &root.to_string_lossy(),
            "project",
            "rtl/new block.sv",
            false,
        )
        .unwrap();
        assert_eq!(created.replace('\\', "/"), "project/rtl/new block.sv");
        assert!(root.join("project/rtl/new block.sv").is_file());
        assert!(create_entry(&root.to_string_lossy(), "project", "../escape.sv", false).is_err());

        let summary =
            replace_text(&root.to_string_lossy(), "project", "signal", "$replacement").unwrap();
        assert_eq!(summary.files_changed, 1);
        assert_eq!(summary.replacements, 3);
        assert_eq!(
            fs::read_to_string(root.join("project/rtl/top.sv")).unwrap(),
            "logic $replacement; // $replacement $replacement\n"
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn unicode_search_reports_original_character_columns_without_panicking() {
        let root =
            std::env::temp_dir().join(format!("fpga-unicode-search-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("rtl")).unwrap();
        fs::write(root.join("fpga.ps1"), "# marker\n").unwrap();
        fs::write(root.join("fpga.config.psd1"), "@{ Top='top' }\n").unwrap();
        fs::write(root.join("rtl/top.sv"), "İİneedle\n").unwrap();

        let matches = search_text(&root.to_string_lossy(), ".", "needle").unwrap();
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].column, 3);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn external_project_reopens_and_keeps_file_operations_inside_its_root() {
        let workspace = std::env::temp_dir().join(format!(
            "fpga-external-workspace-test-{}",
            uuid::Uuid::new_v4()
        ));
        let external_parent = std::env::temp_dir().join(format!(
            "fpga-external-parent-test-{}",
            uuid::Uuid::new_v4()
        ));
        let external = external_parent.join("Natural Project Name");
        fs::create_dir_all(external.join("rtl")).unwrap();
        fs::create_dir_all(&workspace).unwrap();
        fs::write(workspace.join("fpga.ps1"), "# workspace marker\n").unwrap();
        fs::write(external.join("fpga.config.psd1"), "@{ Top='top' }\n").unwrap();
        fs::write(external.join("rtl/top.sv"), "module top; endmodule\n").unwrap();

        let snapshot = open_project(&workspace.to_string_lossy(), &external.to_string_lossy())
            .expect("external project should open");
        assert!(Path::new(&snapshot.project_path).is_absolute());
        assert!(snapshot
            .tree
            .iter()
            .all(|node| Path::new(&node.path).is_absolute()));

        let created = create_entry(
            &workspace.to_string_lossy(),
            &snapshot.project_path,
            "rtl/new module.sv",
            false,
        )
        .expect("external Explorer create");
        write_text(
            &workspace.to_string_lossy(),
            &created,
            "module new_module; endmodule\n",
        )
        .expect("external editor save");
        assert_eq!(
            read_text(&workspace.to_string_lossy(), &created).unwrap(),
            "module new_module; endmodule\n"
        );
        assert_eq!(
            search_text(
                &workspace.to_string_lossy(),
                &snapshot.project_path,
                "new_module"
            )
            .unwrap()
            .len(),
            1
        );

        fs::remove_dir_all(workspace).unwrap();
        fs::remove_dir_all(external_parent).unwrap();
    }

    #[test]
    fn concurrent_saves_never_publish_partial_content() {
        let root = std::env::temp_dir().join(format!(
            "fpga-concurrent-save-test-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(root.join("rtl")).unwrap();
        fs::write(root.join("fpga.ps1"), "# marker\n").unwrap();
        fs::write(root.join("rtl/top.sv"), "original\n").unwrap();
        let candidates = (0..8)
            .map(|index| format!("payload-{index}-{}\n", "x".repeat(16_384)))
            .collect::<Vec<_>>();
        let handles = candidates
            .iter()
            .cloned()
            .map(|content| {
                let root = root.clone();
                std::thread::spawn(move || {
                    write_text(&root.to_string_lossy(), "rtl/top.sv", &content)
                })
            })
            .collect::<Vec<_>>();
        for handle in handles {
            handle.join().unwrap().unwrap();
        }

        let saved = fs::read_to_string(root.join("rtl/top.sv")).unwrap();
        assert!(candidates.contains(&saved));
        assert!(fs::read_dir(root.join("rtl")).unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains("fpga-studio-backup")
        }));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn opening_a_file_recovers_an_interrupted_transaction() {
        let root =
            std::env::temp_dir().join(format!("fpga-save-recovery-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("rtl")).unwrap();
        fs::write(root.join("fpga.ps1"), "# marker\n").unwrap();
        let file = root.join("rtl/top.sv");
        fs::write(&file, "recover me\n").unwrap();
        fs::rename(&file, save_backup_path(&file)).unwrap();

        assert_eq!(
            read_text(&root.to_string_lossy(), "rtl/top.sv").unwrap(),
            "recover me\n"
        );
        assert!(file.is_file());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn creates_transactional_project_from_catalog() {
        let root =
            std::env::temp_dir().join(format!("fpga-studio-project-test-{}", uuid::Uuid::new_v4()));
        let base = root.join("projects/_template");
        let overlay = root.join("templates/demo");
        fs::create_dir_all(base.join("rtl")).expect("base tree");
        fs::create_dir_all(base.join("constraints")).expect("base constraints");
        fs::create_dir_all(base.join("build")).expect("generated tree");
        fs::create_dir_all(overlay.join("rtl")).expect("overlay tree");
        fs::write(root.join("fpga.ps1"), "# test").expect("workspace marker");
        fs::write(base.join("rtl/top.sv"), "module old; endmodule\n").expect("base source");
        fs::write(base.join("build/generated.bin"), "ignore").expect("generated file");
        fs::write(base.join("README.md"), "# Template\n").expect("readme");
        fs::write(
            base.join("fpga.config.psd1"),
            "@{\n Top='top'\n Device='old'\n Family='old'\n YosysFamily='old'\n BuildBackend='old'\n GowinDeviceName='old'\n GowinDeviceCode=''\n GowinDeviceVersion=''\n Constraint='constraints/old.cst'\n TimingConstraint=''\n ClockMHz=1\n ProgrammerBoard='old'\n}\n",
        )
        .expect("base config");
        let repository = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .expect("repository root");
        let board_source = repository.join("boards/gowin/tang_primer_20k");
        let board_target = root.join("boards/gowin/tang_primer_20k");
        fs::create_dir_all(&board_target).expect("board target");
        copy_template_tree(&board_source, &board_target).expect("board package copy");
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
        let chosen_location = root.join("Learning Labs");
        fs::create_dir_all(&chosen_location).expect("chosen project location");

        let result = create_project(
            &root.to_string_lossy(),
            "My Demo Project",
            &chosen_location.to_string_lossy(),
            "demo",
            "Demo project",
            "tang_primer_20k",
        )
        .expect("project creation should pass");
        assert_eq!(result.project_path, "Learning Labs/My Demo Project");
        assert!(root
            .join("Learning Labs/My Demo Project/fpga.project.json")
            .is_file());
        let agent_guide = fs::read_to_string(root.join("Learning Labs/My Demo Project/AGENTS.md"))
            .expect("generated AI guidance");
        assert!(agent_guide.contains("Required verification order"));
        assert!(agent_guide.contains("The user supplies the design requirements"));
        assert!(root.join(".fpga-studio/workspace-state.json").is_file());
        assert_eq!(result.project, "Demo project");
        assert_eq!(
            fs::read_to_string(root.join("Learning Labs/My Demo Project/rtl/top.sv"))
                .expect("created source"),
            "module top; endmodule\n"
        );
        assert!(!root.join("Learning Labs/My Demo Project/build").exists());
        assert!(create_project(
            &root.to_string_lossy(),
            "../escape",
            "",
            "demo",
            "",
            "tang_primer_20k"
        )
        .is_err());
        assert!(create_project(
            &root.to_string_lossy(),
            "My Demo Project",
            &chosen_location.to_string_lossy(),
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
                "",
                "console",
                "Console project",
                board,
            )
            .expect("Console project creation");
            let manifest: serde_json::Value = serde_json::from_slice(
                &fs::read(root.join("projects").join(folder).join("fpga.project.json")).unwrap(),
            )
            .unwrap();
            assert_eq!(manifest["board"]["id"], board);
            let reopened =
                crate::boards::active(&root.to_string_lossy(), &format!("projects/{folder}"))
                    .expect("persisted board selection reopens");
            assert_eq!(reopened.id, board);
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn creates_validates_searches_and_reopens_portable_custom_project() {
        let repository = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .unwrap();
        let root =
            std::env::temp_dir().join(format!("fpga-custom-project-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("projects/_template")).unwrap();
        fs::create_dir_all(root.join("boards/gowin/tang_nano_9k")).unwrap();
        fs::write(root.join("fpga.ps1"), "# workspace marker\n").unwrap();
        copy_template_tree(
            &repository.join("projects/_template"),
            &root.join("projects/_template"),
        )
        .unwrap();
        copy_template_tree(
            &repository.join("boards/gowin/tang_nano_9k"),
            &root.join("boards/gowin/tang_nano_9k"),
        )
        .unwrap();
        let profile = crate::boards::list(&root.to_string_lossy())
            .unwrap()
            .remove(0);
        let request = CustomProjectRequest {
            display_name: "Portable Nano laboratory".into(),
            board_id: profile.id.clone(),
            target: fpga_target(&profile),
            top: "lab_top".into(),
            clock_signal: profile.clocks[0].name.clone(),
            clock_mhz: 30.0,
            constraint_path: "constraints/custom_board.cst".into(),
            timing_constraint_path: None,
            toolchain: "oss-cad-suite".into(),
            programmer: profile.programmer.board.clone(),
            source_roots: vec!["rtl".into()],
            test_roots: vec!["sim".into()],
        };
        let created = create_custom_project(
            &root.to_string_lossy(),
            "04_portable_lab",
            "",
            request.clone(),
        )
        .expect("custom project creation");
        assert_eq!(created.project, "Portable Nano laboratory");
        let directory = root.join("projects/04_portable_lab");
        let manifest_text = fs::read_to_string(directory.join("fpga.project.json")).unwrap();
        assert!(directory.join("AGENTS.md").is_file());
        let manifest: serde_json::Value = serde_json::from_str(&manifest_text).unwrap();
        assert_eq!(manifest["schemaVersion"], 2);
        assert_eq!(manifest["mode"], "custom");
        assert_eq!(manifest["board"]["id"], "tang_nano_9k");
        assert_eq!(manifest["target"]["device"], profile.device);
        assert_eq!(manifest["top"], "lab_top");
        assert!(!manifest_text.contains(&root.to_string_lossy().to_string()));
        assert!(directory.join("constraints/custom_board.cst").is_file());
        let config = fs::read_to_string(directory.join("fpga.config.psd1")).unwrap();
        assert!(
            config.contains("Top              = 'lab_top'") || config.contains("Top='lab_top'")
        );
        assert!(config.contains("ClockMHz         = 30") || config.contains("ClockMHz=30"));
        assert!(fs::read_to_string(directory.join("rtl/top.sv"))
            .unwrap()
            .contains("module lab_top"));

        let reopened = open_project(&root.to_string_lossy(), "projects/04_portable_lab")
            .expect("custom project reopens");
        assert_eq!(reopened.project, "Portable Nano laboratory");
        assert_eq!(reopened.project_path, "projects/04_portable_lab");
        let matches = search_text(&root.to_string_lossy(), &reopened.project_path, "counter")
            .expect("indexed project search");
        assert!(matches.iter().any(|item| item.file.ends_with("rtl/top.sv")));

        let mut invalid = request;
        invalid.target.device = "unsupported-device".into();
        assert!(
            create_custom_project(&root.to_string_lossy(), "05_invalid_target", "", invalid)
                .is_err()
        );
        assert!(!root.join("projects/05_invalid_target").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
