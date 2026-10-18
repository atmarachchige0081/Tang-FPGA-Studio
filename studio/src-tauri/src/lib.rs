mod ai;
mod analyzer;
mod boards;
mod changes;
mod design_graph;
mod git;
mod hardware;
mod hdl;
mod ip;
mod models;
mod netlist;
mod optimizer;
mod plugins;
mod process_cleanup;
mod project;
mod reports;
mod runner;
mod security;
mod terminal;
mod verification;
mod waveform;

use ai::{AiApprovalDecision, AiIdeContext, AiLoginResult, AiProviderStatus, AiRegistry};
use hardware::SerialRegistry;
use models::{
    AnalyzerCapture, AnalyzerConfig, AnalyzerWorkspace, BoardProfile, BuildAction,
    BuildHistoryEntry, BuildSummary, CommandResult, CustomProjectRequest, DesignIntelligenceGraph,
    DesignSnapshot, GitStatus, HdlIndex, HdlPattern, NetlistGraph, OptimizationExperiment,
    OptimizationSummary, PluginInfo, ProjectReplaceSummary, ProjectSearchMatch, ProjectTemplate,
    SerialDevice, SnapshotComparison, VerificationSummary, WaveformData, WorkspaceSnapshot,
};
use runner::JobRegistry;
use serde_json::Value;
use tauri::{AppHandle, State};

async fn blocking<T, F>(label: &'static str, operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(operation))
            .unwrap_or_else(|_| Err(format!("{label} failed unexpectedly. The app is still open; see the crash log for details.")))
    })
        .await
        .map_err(|error| format!("{label} worker stopped unexpectedly: {error}"))?
}

#[tauri::command]
async fn poll_project_changes(
    registry: State<'_, changes::ChangeRegistry>,
    root: String,
    project: String,
    since: Option<u64>,
) -> Result<changes::ChangeSnapshot, String> {
    let registry = registry.inner().clone();
    blocking("Project change journal", move || {
        registry.poll(&root, &project, since)
    })
    .await
}
#[tauri::command]
async fn mark_change_reviewed(
    registry: State<'_, changes::ChangeRegistry>,
    root: String,
    project: String,
    path: String,
    revision: u64,
) -> Result<(), String> {
    let registry = registry.inner().clone();
    blocking("Change review", move || {
        registry.reviewed(&root, &project, &path, revision)
    })
    .await
}
#[tauri::command]
async fn terminal_open(
    app: AppHandle,
    registry: State<'_, std::sync::Arc<terminal::TerminalRegistry>>,
    root: String,
    project: String,
    cols: u16,
    rows: u16,
) -> Result<terminal::TerminalEvent, String> {
    let registry = registry.inner().clone();
    blocking("Terminal startup", move || {
        registry.open(app, &root, &project, cols, rows)
    })
    .await
}
#[tauri::command]
async fn terminal_write(
    registry: State<'_, std::sync::Arc<terminal::TerminalRegistry>>,
    id: String,
    data: String,
) -> Result<(), String> {
    let registry = registry.inner().clone();
    blocking("Terminal input", move || registry.write(&id, &data)).await
}
#[tauri::command]
async fn terminal_resize(
    registry: State<'_, std::sync::Arc<terminal::TerminalRegistry>>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let registry = registry.inner().clone();
    blocking("Terminal resize", move || registry.resize(&id, cols, rows)).await
}
#[tauri::command]
async fn terminal_close(
    registry: State<'_, std::sync::Arc<terminal::TerminalRegistry>>,
    id: String,
) -> Result<(), String> {
    let registry = registry.inner().clone();
    blocking("Terminal close", move || registry.close(&id)).await
}
#[tauri::command]
async fn sync_project_files(
    root: String,
    project: String,
    files: Vec<project::FileProbe>,
) -> Result<Vec<project::FileUpdate>, String> {
    blocking("File synchronization", move || {
        project::sync_files(&root, &project, files)
    })
    .await
}
#[tauri::command]
async fn project_tree(root: String, project: String) -> Result<Vec<models::ProjectNode>, String> {
    blocking("Project refresh", move || {
        project::project_tree(&root, &project)
    })
    .await
}

#[tauri::command]
async fn workspace_snapshot() -> Result<WorkspaceSnapshot, String> {
    blocking("Workspace scan", project::snapshot).await
}

#[tauri::command]
async fn recognize_project_folder(
    folder: String,
) -> Result<Vec<project::RecognizedProject>, String> {
    blocking("Project recognition", move || {
        project::recognize_projects(&folder)
    })
    .await
}

#[tauri::command]
async fn open_project(
    jobs: State<'_, JobRegistry>,
    root: String,
    project: String,
) -> Result<WorkspaceSnapshot, String> {
    if jobs.is_active() {
        return Err("Wait for the current FPGA task to finish before changing projects.".into());
    }
    blocking("Project open", move || {
        project::open_project(&root, &project)
    })
    .await
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
async fn search_project_text(
    root: String,
    project: String,
    query: String,
) -> Result<Vec<ProjectSearchMatch>, String> {
    blocking("Project search", move || {
        project::search_text(&root, &project, &query)
    })
    .await
}

#[tauri::command]
async fn replace_project_text(
    root: String,
    project: String,
    query: String,
    replacement: String,
) -> Result<ProjectReplaceSummary, String> {
    blocking("Project replacement", move || {
        project::replace_text(&root, &project, &query, &replacement)
    })
    .await
}

#[tauri::command]
async fn create_project_entry(
    root: String,
    project: String,
    path: String,
    directory: bool,
) -> Result<String, String> {
    blocking("Project entry creation", move || {
        project::create_entry(&root, &project, &path, directory)
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
async fn read_git_status(root: String, project: String) -> Result<GitStatus, String> {
    blocking("Git status", move || git::status(&root, &project)).await
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
    jobs: State<'_, JobRegistry>,
    root: String,
    name: String,
    location: String,
    template_id: String,
    display_name: String,
    board_id: String,
) -> Result<WorkspaceSnapshot, String> {
    if jobs.is_active() {
        return Err("Wait for the current FPGA task to finish before creating a project.".into());
    }
    blocking("Project creation", move || {
        project::create_project(
            &root,
            &name,
            &location,
            &template_id,
            &display_name,
            &board_id,
        )
    })
    .await
}

#[tauri::command]
async fn create_custom_project(
    jobs: State<'_, JobRegistry>,
    root: String,
    name: String,
    location: String,
    request: CustomProjectRequest,
) -> Result<WorkspaceSnapshot, String> {
    if jobs.is_active() {
        return Err("Wait for the current FPGA task to finish before creating a project.".into());
    }
    blocking("Custom project creation", move || {
        project::create_custom_project(&root, &name, &location, request)
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

#[tauri::command]
async fn ai_provider_status(registry: State<'_, AiRegistry>) -> Result<AiProviderStatus, String> {
    let registry = registry.inner().clone();
    blocking("AI provider status", move || Ok(registry.status())).await
}

#[tauri::command]
async fn ai_connect(
    app: AppHandle,
    registry: State<'_, AiRegistry>,
    root: String,
    project: String,
) -> Result<AiProviderStatus, String> {
    let registry = registry.inner().clone();
    blocking("AI provider connection", move || {
        registry.connect(app, &root, &project)
    })
    .await
}

#[tauri::command]
async fn ai_disconnect(registry: State<'_, AiRegistry>) -> Result<bool, String> {
    let registry = registry.inner().clone();
    blocking("AI provider disconnect", move || registry.disconnect()).await
}

#[tauri::command]
async fn ai_pending_requests(registry: State<'_, AiRegistry>) -> Result<Vec<ai::AiEvent>, String> {
    registry.pending_requests()
}

#[tauri::command]
async fn ai_account_read(registry: State<'_, AiRegistry>, refresh: bool) -> Result<Value, String> {
    let registry = registry.inner().clone();
    blocking("AI account status", move || registry.account(refresh)).await
}

#[tauri::command]
async fn ai_login_chatgpt(
    registry: State<'_, AiRegistry>,
    device_code: bool,
) -> Result<AiLoginResult, String> {
    let registry = registry.inner().clone();
    blocking("ChatGPT sign in", move || {
        registry.login_chatgpt(device_code)
    })
    .await
}

#[tauri::command]
async fn ai_login_api_key(
    registry: State<'_, AiRegistry>,
    api_key: String,
) -> Result<AiLoginResult, String> {
    let registry = registry.inner().clone();
    blocking("OpenAI API key sign in", move || {
        registry.login_api_key(&api_key)
    })
    .await
}

#[tauri::command]
async fn ai_cancel_login(
    registry: State<'_, AiRegistry>,
    login_id: String,
) -> Result<Value, String> {
    let registry = registry.inner().clone();
    blocking("AI login cancellation", move || {
        registry.cancel_login(&login_id)
    })
    .await
}

#[tauri::command]
async fn ai_logout(registry: State<'_, AiRegistry>) -> Result<Value, String> {
    let registry = registry.inner().clone();
    blocking("AI logout", move || registry.logout()).await
}

#[tauri::command]
async fn ai_open_auth_url(url: String) -> Result<(), String> {
    blocking("AI sign-in page", move || ai::open_auth_url(&url)).await
}

#[tauri::command]
async fn ai_thread_list(registry: State<'_, AiRegistry>) -> Result<Value, String> {
    let registry = registry.inner().clone();
    blocking("AI conversation list", move || registry.list_threads()).await
}

#[tauri::command]
async fn ai_thread_read(
    registry: State<'_, AiRegistry>,
    thread_id: String,
) -> Result<Value, String> {
    let registry = registry.inner().clone();
    blocking("AI conversation read", move || {
        registry.read_thread(&thread_id)
    })
    .await
}

#[tauri::command]
async fn ai_thread_start(
    registry: State<'_, AiRegistry>,
    model: Option<String>,
) -> Result<Value, String> {
    let registry = registry.inner().clone();
    blocking("AI conversation start", move || {
        registry.start_thread(model)
    })
    .await
}

#[tauri::command]
async fn ai_model_list(registry: State<'_, AiRegistry>) -> Result<Value, String> {
    let registry = registry.inner().clone();
    blocking("AI model catalog", move || registry.list_models()).await
}

#[tauri::command]
async fn ai_thread_resume(
    registry: State<'_, AiRegistry>,
    thread_id: String,
) -> Result<Value, String> {
    let registry = registry.inner().clone();
    blocking("AI conversation resume", move || {
        registry.resume_thread(&thread_id)
    })
    .await
}

#[tauri::command]
async fn ai_turn_start(
    registry: State<'_, AiRegistry>,
    thread_id: String,
    prompt: String,
    context: AiIdeContext,
    model: Option<String>,
    effort: Option<String>,
) -> Result<Value, String> {
    let registry = registry.inner().clone();
    blocking("AI turn start", move || {
        registry.start_turn(&thread_id, &prompt, context, model, effort)
    })
    .await
}

#[tauri::command]
async fn ai_inline_completion(
    registry: State<'_, AiRegistry>,
    project: String,
    path: String,
    prefix: String,
    suffix: String,
) -> Result<String, String> {
    let registry = registry.inner().clone();
    blocking("Inline suggestion", move || {
        registry.inline_completion(&project, &path, &prefix, &suffix)
    })
    .await
}

#[tauri::command]
async fn ai_turn_steer(
    registry: State<'_, AiRegistry>,
    thread_id: String,
    turn_id: String,
    prompt: String,
) -> Result<Value, String> {
    let registry = registry.inner().clone();
    blocking("AI follow-up", move || {
        registry.steer_turn(&thread_id, &turn_id, &prompt)
    })
    .await
}

#[tauri::command]
async fn ai_turn_interrupt(
    registry: State<'_, AiRegistry>,
    jobs: State<'_, JobRegistry>,
    thread_id: String,
    turn_id: String,
) -> Result<Value, String> {
    let _ = registry.cancel_tang_job(&turn_id, jobs.inner());
    let registry = registry.inner().clone();
    blocking("AI turn cancellation", move || {
        registry.interrupt_turn(&thread_id, &turn_id)
    })
    .await
}

#[tauri::command]
async fn ai_execute_tang_tool(
    app: AppHandle,
    jobs: State<'_, JobRegistry>,
    registry: State<'_, AiRegistry>,
    request_id: Value,
) -> Result<CommandResult, String> {
    registry
        .inner()
        .clone()
        .execute_tang_tool(app, jobs.inner().clone(), request_id)
        .await
}

#[tauri::command]
async fn ai_respond_approval(
    registry: State<'_, AiRegistry>,
    request_id: Value,
    decision: AiApprovalDecision,
    dirty_paths: Vec<String>,
) -> Result<(), String> {
    let registry = registry.inner().clone();
    blocking("AI approval response", move || {
        registry.respond_to_approval(request_id, decision, dirty_paths)
    })
    .await
}

#[tauri::command]
async fn ai_respond_user_input(
    registry: State<'_, AiRegistry>,
    request_id: Value,
    answers: Value,
) -> Result<(), String> {
    let registry = registry.inner().clone();
    blocking("AI user input", move || {
        registry.respond_to_user_input(request_id, answers)
    })
    .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() -> Result<(), String> {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|window, event| {
            use tauri::{Emitter, Manager};
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.state::<JobRegistry>().is_active() {
                    api.prevent_close();
                    let _ = window.emit("runtime-warning", "A hardware or build task is still running. Wait for it to finish before closing the app.");
                }
            }
        })
        .setup(|app| {
            #[cfg(target_os = "linux")]
            if std::env::var_os("FPGA_STUDIO_WORKSPACE").is_none() {
                use tauri::Manager;
                let bundled = app.path().resource_dir()?.join("workspace");
                if bundled.join("fpga.ps1").is_file() {
                    let writable = app
                        .path()
                        .app_data_dir()?
                        .join(concat!("workspace-", env!("CARGO_PKG_VERSION")));
                    project::copy_bundled_workspace(&bundled, &writable)
                        .map_err(std::io::Error::other)?;
                    std::env::set_var("FPGA_STUDIO_WORKSPACE", writable);
                }
            }
            #[cfg(not(target_os = "linux"))]
            let _ = app;
            Ok(())
        })
        .manage(JobRegistry::default())
        .manage(changes::ChangeRegistry::default())
        .manage(SerialRegistry::default())
        .manage(AiRegistry::default())
        .manage(std::sync::Arc::new(terminal::TerminalRegistry::default()))
        .invoke_handler(tauri::generate_handler![
            workspace_snapshot,
            poll_project_changes, mark_change_reviewed,
            terminal_open, terminal_write, terminal_resize, terminal_close,
            sync_project_files, project_tree,
            open_project,
            recognize_project_folder,
            read_text_file,
            write_text_file,
            search_project_text,
            replace_project_text,
            create_project_entry,
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
            create_custom_project,
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
            ai_provider_status,
            ai_connect,
            ai_disconnect,
            ai_account_read,
            ai_pending_requests,
            ai_login_chatgpt,
            ai_login_api_key,
            ai_cancel_login,
            ai_logout,
            ai_open_auth_url,
            ai_thread_list,
            ai_thread_read,
            ai_thread_start,
            ai_model_list,
            ai_thread_resume,
            ai_turn_start,
            ai_turn_interrupt,
            ai_turn_steer,
            ai_inline_completion,
            ai_execute_tang_tool,
            ai_respond_approval,
            ai_respond_user_input,
        ])
        .build(tauri::generate_context!())
        .map_err(|error| format!("FPGA Studio could not start: {error}"))?
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                use tauri::Manager;
                // App::run exits the process directly; managed-state Drop is not an exit hook.
                app.state::<AiRegistry>().shutdown();
                app.state::<std::sync::Arc<terminal::TerminalRegistry>>().shutdown();
                app.state::<SerialRegistry>().shutdown();
            }
        });
    Ok(())
}

pub fn smoke_test() -> Result<(), String> {
    if !cfg!(debug_assertions) && tauri::is_dev() {
        return Err("This release binary uses Tauri development mode and would require a local frontend server.".into());
    }
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
    let _git = git::status(&snapshot.root, &snapshot.project_path)?;
    let _hdl = hdl::index(&snapshot.root, &snapshot.project_path)?;
    Ok(())
}

#[cfg(test)]
mod recovery_tests {
    #[test]
    fn failed_background_task_does_not_stop_subsequent_work() {
        let error = tauri::async_runtime::block_on(super::blocking(
            "Test worker",
            || -> Result<(), String> {
                panic!("simulated task panic");
            },
        ))
        .unwrap_err();
        assert!(error.contains("app is still open"));
        let result =
            tauri::async_runtime::block_on(super::blocking("Next worker", || Ok(42))).unwrap();
        assert_eq!(result, 42);
    }
}
