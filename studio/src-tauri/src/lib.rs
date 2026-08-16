mod analyzer;
mod boards;
mod design_graph;
mod git;
mod hardware;
mod hdl;
mod ip;
mod models;
mod netlist;
mod optimizer;
mod plugins;
mod project;
mod reports;
mod runner;
mod security;
mod verification;
mod waveform;

use hardware::SerialRegistry;
use models::{
    AnalyzerCapture, AnalyzerConfig, AnalyzerWorkspace, BoardProfile, BuildAction,
    BuildHistoryEntry, BuildSummary, CommandResult, DesignIntelligenceGraph, DesignSnapshot,
    GitStatus, HdlIndex, HdlPattern, NetlistGraph, OptimizationExperiment, OptimizationSummary,
    PluginInfo, ProjectTemplate, SerialDevice, SnapshotComparison, VerificationSummary,
    WaveformData, WorkspaceSnapshot,
};
use runner::JobRegistry;
use tauri::{AppHandle, State};

async fn blocking<T, F>(label: &'static str, operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| format!("{label} worker stopped unexpectedly: {error}"))?
}

#[tauri::command]
async fn workspace_snapshot() -> Result<WorkspaceSnapshot, String> {
    blocking("Workspace scan", project::snapshot).await
}

#[tauri::command]
async fn read_text_file(root: String, path: String) -> Result<String, String> {
    blocking("File read", move || project::read_text(&root, &path)).await
}

#[tauri::command]
async fn write_text_file(root: String, path: String, content: String) -> Result<(), String> {
    blocking("File save", move || {
        project::write_text(&root, &path, &content)
    })
    .await
}

#[tauri::command]
async fn list_project_templates(root: String) -> Result<Vec<ProjectTemplate>, String> {
    blocking("Template scan", move || project::templates(&root)).await
}

#[tauri::command]
async fn list_hdl_patterns(root: String) -> Result<Vec<HdlPattern>, String> {
    blocking("HDL pattern scan", move || ip::patterns(&root)).await
}

#[tauri::command]
async fn list_boards(root: String) -> Result<Vec<BoardProfile>, String> {
    blocking("Board package scan", move || boards::list(&root)).await
}

#[tauri::command]
async fn active_board(root: String, project: String) -> Result<BoardProfile, String> {
    blocking("Active board scan", move || boards::active(&root, &project)).await
}

#[tauri::command]
async fn read_git_status(root: String) -> Result<GitStatus, String> {
    blocking("Git status", move || git::status(&root)).await
}

#[tauri::command]
async fn list_plugins(root: String) -> Result<Vec<PluginInfo>, String> {
    blocking("Plugin scan", move || plugins::list(&root)).await
}

#[tauri::command]
async fn read_hdl_index(root: String, project: String) -> Result<HdlIndex, String> {
    blocking("HDL index", move || hdl::index(&root, &project)).await
}

#[tauri::command]
async fn read_design_graph(
    root: String,
    project: String,
) -> Result<DesignIntelligenceGraph, String> {
    blocking("Design intelligence graph", move || {
        design_graph::read(&root, &project)
    })
    .await
}

#[tauri::command]
async fn read_analyzer_workspace(
    root: String,
    project: String,
) -> Result<AnalyzerWorkspace, String> {
    blocking("Logic analyzer workspace", move || {
        analyzer::workspace(&root, &project)
    })
    .await
}

#[tauri::command]
async fn save_analyzer_config(
    root: String,
    project: String,
    config: AnalyzerConfig,
) -> Result<AnalyzerWorkspace, String> {
    blocking("Logic analyzer configuration", move || {
        analyzer::save(&root, &project, config)
    })
    .await
}

#[tauri::command]
async fn prepare_analyzer(root: String, project: String) -> Result<AnalyzerWorkspace, String> {
    blocking("Logic analyzer generation", move || {
        analyzer::prepare(&root, &project)
    })
    .await
}

#[tauri::command]
async fn capture_analyzer(
    root: String,
    project: String,
    port_name: String,
    timeout_ms: u64,
) -> Result<AnalyzerCapture, String> {
    blocking("Logic analyzer capture", move || {
        analyzer::capture(&root, &project, &port_name, timeout_ms)
    })
    .await
}

#[tauri::command]
async fn read_analyzer_capture(
    root: String,
    project: String,
) -> Result<Option<AnalyzerCapture>, String> {
    blocking("Logic analyzer capture read", move || {
        analyzer::latest_capture(&root, &project)
    })
    .await
}

#[tauri::command]
async fn read_optimization_summary(
    root: String,
    project: String,
) -> Result<OptimizationSummary, String> {
    blocking("Design health", move || optimizer::summary(&root, &project)).await
}

#[tauri::command]
async fn record_design_snapshot(
    root: String,
    project: String,
    kind: String,
    experiment_id: Option<String>,
) -> Result<DesignSnapshot, String> {
    blocking("Design snapshot", move || {
        optimizer::record_snapshot(&root, &project, &kind, experiment_id)
    })
    .await
}

#[tauri::command]
async fn compare_design_snapshots(
    root: String,
    project: String,
    baseline_id: u64,
    candidate_id: u64,
) -> Result<SnapshotComparison, String> {
    blocking("Snapshot comparison", move || {
        optimizer::compare(&root, &project, baseline_id, candidate_id)
    })
    .await
}

#[tauri::command]
async fn prepare_optimization_experiment(
    root: String,
    project: String,
    recommendation_id: String,
) -> Result<OptimizationExperiment, String> {
    blocking("Optimization experiment", move || {
        optimizer::prepare_experiment(&root, &project, &recommendation_id)
    })
    .await
}

#[tauri::command]
async fn finish_optimization_experiment(
    root: String,
    project: String,
    experiment_id: String,
    success: bool,
) -> Result<OptimizationExperiment, String> {
    blocking("Optimization experiment result", move || {
        optimizer::finish_experiment(&root, &project, &experiment_id, success)
    })
    .await
}

#[tauri::command]
async fn create_project(
    root: String,
    name: String,
    template_id: String,
    display_name: String,
    board_id: String,
) -> Result<WorkspaceSnapshot, String> {
    blocking("Project creation", move || {
        project::create_project(&root, &name, &template_id, &display_name, &board_id)
    })
    .await
}

#[tauri::command]
async fn run_fpga_command(
    app: AppHandle,
    jobs: State<'_, JobRegistry>,
    root: String,
    project: String,
    action: BuildAction,
    job_id: String,
) -> Result<CommandResult, String> {
    runner::run(app, jobs.inner().clone(), root, project, action, job_id).await
}

#[tauri::command]
fn cancel_job(jobs: State<'_, JobRegistry>, job_id: String) -> Result<bool, String> {
    jobs.cancel(&job_id)
}

#[tauri::command]
async fn read_build_summary(root: String, project: String) -> Result<BuildSummary, String> {
    blocking("Build summary", move || {
        reports::build_summary(&root, &project)
    })
    .await
}

#[tauri::command]
async fn read_build_history(
    root: String,
    project: String,
) -> Result<Vec<BuildHistoryEntry>, String> {
    blocking("Build history", move || {
        reports::build_history(&root, &project)
    })
    .await
}

#[tauri::command]
async fn read_verification_summary(
    root: String,
    project: String,
) -> Result<VerificationSummary, String> {
    blocking("Verification summary", move || {
        verification::summary(&root, &project)
    })
    .await
}

#[tauri::command]
async fn record_hardware_verification(
    root: String,
    project: String,
    passed: bool,
    note: String,
) -> Result<VerificationSummary, String> {
    blocking("Hardware verification", move || {
        verification::record_hardware(&root, &project, passed, &note)
    })
    .await
}

#[tauri::command]
async fn list_serial_devices() -> Result<Vec<SerialDevice>, String> {
    blocking("Serial device scan", hardware::serial_devices).await
}

#[tauri::command]
async fn launch_zadig(root: String, project: String) -> Result<String, String> {
    blocking("Driver helper", move || {
        hardware::launch_zadig(&root, &project)
    })
    .await
}

#[tauri::command]
async fn connect_serial(
    app: AppHandle,
    sessions: State<'_, SerialRegistry>,
    port_name: String,
    baud_rate: u32,
    session_id: String,
) -> Result<(), String> {
    let registry = sessions.inner().clone();
    blocking("Serial connection", move || {
        hardware::connect(app, registry, port_name, baud_rate, session_id)
    })
    .await
}

#[tauri::command]
async fn write_serial(
    sessions: State<'_, SerialRegistry>,
    session_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    let registry = sessions.inner().clone();
    blocking("Serial write", move || {
        hardware::write(&registry, &session_id, data)
    })
    .await
}

#[tauri::command]
async fn disconnect_serial(
    sessions: State<'_, SerialRegistry>,
    session_id: String,
) -> Result<bool, String> {
    let registry = sessions.inner().clone();
    blocking("Serial disconnect", move || {
        hardware::disconnect(&registry, &session_id)
    })
    .await
}

#[tauri::command]
async fn read_waveform(root: String, project: String) -> Result<WaveformData, String> {
    blocking("Waveform parser", move || waveform::read(&root, &project)).await
}

#[tauri::command]
async fn read_netlist(root: String, project: String) -> Result<NetlistGraph, String> {
    blocking("Netlist parser", move || netlist::read(&root, &project)).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() -> Result<(), String> {
    tauri::Builder::default()
        .manage(JobRegistry::default())
        .manage(SerialRegistry::default())
        .invoke_handler(tauri::generate_handler![
            workspace_snapshot,
            read_text_file,
            write_text_file,
            list_project_templates,
            list_hdl_patterns,
            list_boards,
            active_board,
            read_git_status,
            list_plugins,
            read_hdl_index,
            read_design_graph,
            read_analyzer_workspace,
            save_analyzer_config,
            prepare_analyzer,
            capture_analyzer,
            read_analyzer_capture,
            read_optimization_summary,
            record_design_snapshot,
            compare_design_snapshots,
            prepare_optimization_experiment,
            finish_optimization_experiment,
            create_project,
            run_fpga_command,
            cancel_job,
            read_build_summary,
            read_build_history,
            read_verification_summary,
            record_hardware_verification,
            list_serial_devices,
            launch_zadig,
            connect_serial,
            write_serial,
            disconnect_serial,
            read_waveform,
            read_netlist,
        ])
        .run(tauri::generate_context!())
        .map_err(|error| format!("FPGA Studio could not start: {error}"))
}

pub fn smoke_test() -> Result<(), String> {
    let snapshot = project::snapshot()?;
    let boards = boards::list(&snapshot.root)?;
    if boards.len() < 7 {
        return Err(format!(
            "Expected at least seven board profiles, found {}",
            boards.len()
        ));
    }
    let _active = boards::active(&snapshot.root, &snapshot.project_path)?;
    let patterns = ip::patterns(&snapshot.root)?;
    if patterns.len() < 50 {
        return Err(format!(
            "Expected at least 50 HDL patterns, found {}",
            patterns.len()
        ));
    }
    let providers = plugins::list(&snapshot.root)?;
    if providers.iter().any(|provider| !provider.valid) {
        return Err("At least one bundled plugin provider is invalid".into());
    }
    let _git = git::status(&snapshot.root)?;
    let _hdl = hdl::index(&snapshot.root, &snapshot.project_path)?;
    Ok(())
}
