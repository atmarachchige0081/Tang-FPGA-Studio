import { useCallback, useEffect, useRef, useState } from "react";
import { PanelResizeHandle, usePanelLayout, panelLayoutStyle } from "./components/PanelResizeHandle";
import { ActivityBar } from "./components/ActivityBar";
import { BottomDock } from "./components/BottomDock";
import { CommandBar } from "./components/CommandBar";
import { EditorWorkspace } from "./components/EditorWorkspace";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { TitleBar } from "./components/TitleBar";
import { ProjectChangeReview } from "./components/ProjectChangeReview";
import { OpenProjectDialog } from "./components/OpenProjectDialog";
import { ProjectWizard } from "./components/ProjectWizard";
import { ReleaseNotes } from "./components/ReleaseNotes";
import { QuickLauncher } from "./components/QuickLauncher";
import { DashboardView, HardwareView, NetlistView, UartView, WaveformView, WelcomeView } from "./components/WorkbenchViews";
import { AnalysisView } from "./components/AnalysisView";
import { VerificationView } from "./components/VerificationView";
import { DesignHealthView, LogicAnalyzerView, TraceabilityView } from "./components/HardwareIntelligence";
import { AiPanel } from "./ai/AiPanel";
import { bridge } from "./lib/bridge";
import { useProjectFileSync } from "./lib/file-sync";
import { expectedCancellation } from "./lib/errors";
import { hasUnsavedChanges } from "./lib/documents";
import { useWorkbench } from "./store/workbench";
import type { BuildAction, BuildEvent, WorkbenchView } from "./types";

const viewComponents: Record<Exclude<WorkbenchView, "editor" | "verification" | "analyzer" | "health">, React.ComponentType> = {
  dashboard: DashboardView,
  analysis: AnalysisView,
  traceability: TraceabilityView,
  netlist: NetlistView,
  waveform: WaveformView,
  hardware: HardwareView,
  uart: UartView,
  welcome: WelcomeView,
};

function Workbench(): React.JSX.Element {
  const store = useWorkbench();
  useProjectFileSync();
  const layout = usePanelLayout((state) => state.sizes);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const runLock = useRef(false);
  const saveLock = useRef(false);
  const documentationCaptureApplied = useRef(false);

  useEffect(() => {
    const report = (reason: unknown) => {
      if (expectedCancellation(reason)) return;
      const message = reason instanceof Error ? reason.message : String(reason ?? "Unknown error");
      setRuntimeError(message);
      useWorkbench.getState().appendOutput({ jobId: "interface", phase: "error", stream: "stderr", message, timestamp: new Date().toISOString() });
    };
    const rejected = (event: PromiseRejectionEvent) => report(event.reason);
    const failed = (event: ErrorEvent) => report(event.error ?? event.message);
    window.addEventListener("unhandledrejection", rejected);
    window.addEventListener("error", failed);
    return () => { window.removeEventListener("unhandledrejection", rejected); window.removeEventListener("error", failed); };
  }, []);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().onCloseRequested(async (event) => {
      const state = useWorkbench.getState();
      if (state.runningJob) {
        event.preventDefault();
        setRuntimeError("A hardware or build task is still running. Wait for it to finish before closing the app.");
      } else if (hasUnsavedChanges(state.tabs)) {
        event.preventDefault();
        setRuntimeError("Save or close your modified files before closing the app.");
      }
    })).then((stop) => { if (disposed) stop(); else unlisten = stop; }).catch((error) => setRuntimeError(String(error)));
    return () => { disposed = true; unlisten?.(); };
  }, []);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) => listen<string>("runtime-warning", (event) => setRuntimeError(event.payload)))
      .then((stop) => { if (disposed) stop(); else unlisten = stop; }).catch((error) => setRuntimeError(String(error)));
    return () => { disposed = true; unlisten?.(); };
  }, []);

  useEffect(() => {
    const protectUnsaved = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges(useWorkbench.getState().tabs)) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectUnsaved);
    return () => window.removeEventListener("beforeunload", protectUnsaved);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => document.documentElement.dataset.theme = store.theme === "system" ? (media.matches ? "light" : "dark") : store.theme;
    const resetViewport = () => window.scrollTo({ left: 0, top: 0 });
    apply();
    resetViewport();
    media.addEventListener("change", apply);
    window.addEventListener("resize", resetViewport);
    return () => {
      media.removeEventListener("change", apply);
      window.removeEventListener("resize", resetViewport);
    };
  }, [store.theme]);

  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "l") {
        event.preventDefault();
        store.setTheme(store.theme === "light" ? "dark" : "light");
      }
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "a") {
        event.preventDefault();
        store.toggleAiPanel();
      }
    };
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  }, [store.theme]);

  useEffect(() => {
    let disposed = false;
    if (!useWorkbench.getState().ready) void (async () => {
      const snapshot = await bridge.workspaceSnapshot();
      if (disposed) return;
      store.setWorkspace(snapshot.root, snapshot.project, snapshot.projectPath, snapshot.tree, snapshot.recentProjects);
      const [summary, board] = await Promise.all([
        bridge.buildSummary(snapshot.root, snapshot.projectPath),
        bridge.activeBoard(snapshot.root, snapshot.projectPath),
      ]);
      if (!disposed) { store.setBuild(summary); store.setBoard(board); }
      void bridge.gitStatus(snapshot.root, snapshot.projectPath).then((status) => { if (!disposed) store.setGit(status); }).catch(() => undefined);
    })().catch((error: unknown) => {
      store.appendOutput({ jobId: "startup", phase: "workspace", stream: "stderr", message: error instanceof Error ? error.message : String(error), timestamp: new Date().toISOString() });
    });
    let unlisten: (() => void) | undefined;
    void bridge.onBuildEvent((event: BuildEvent) => store.appendOutput(event)).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch((error: unknown) => {
      if (!disposed) store.appendOutput({ jobId: "startup", phase: "events", stream: "stderr", message: error instanceof Error ? error.message : String(error), timestamp: new Date().toISOString() });
    });
    return () => { disposed = true; unlisten?.(); };
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV || !store.ready || documentationCaptureApplied.current) return;
    const parameters = new URLSearchParams(window.location.search);
    const capture = parameters.get("capture");
    if (!capture) return;
    documentationCaptureApplied.current = true;
    const requestedTheme = parameters.get("theme");
    if (requestedTheme === "dark" || requestedTheme === "light") store.setTheme(requestedTheme);
    const captureViews: Partial<Record<string, WorkbenchView>> = {
      welcome: "welcome",
      dashboard: "dashboard",
      waveform: "waveform",
      netlist: "netlist",
      hardware: "hardware",
      uart: "uart",
      analysis: "analysis",
      traceability: "traceability",
      analyzer: "analyzer",
      health: "health",
      verification: "verification",
      launcher: "welcome",
      "release-notes": "welcome",
      "project-wizard": "welcome",
      "custom-project": "welcome",
      "project-search": "welcome",
    };
    const requestedView = captureViews[capture];
    if (requestedView) store.setView(requestedView);
    if ((capture === "analysis" || capture === "verification") && store.bottomOpen) store.toggleBottom();
    if (capture === "launcher") {
      window.setTimeout(() => window.dispatchEvent(new Event("fpga-studio:command-center")), 150);
    }
    if (capture === "project-wizard" || capture === "custom-project") {
      window.setTimeout(store.openProjectWizard, 150);
    }
    if (capture === "project-search") {
      store.setActivity("search");
      window.setTimeout(() => window.dispatchEvent(new CustomEvent("fpga-studio:workspace-search", { detail: { mode: "symbols" } })), 200);
    }
  }, [store.ready]);

  const run = useCallback(async (action: BuildAction) => {
    if (store.runningJob || runLock.current) return false;
    runLock.current = true;
    const optimisticId = `starting-${Date.now()}`;
    store.setRunningJob(optimisticId);
    store.setBottomPanel("output");
    store.appendOutput({ jobId: optimisticId, phase: action, stream: "system", message: `Starting ${action}…`, timestamp: new Date().toISOString() });
    try {
      const result = await bridge.run(store.root, store.projectPath, action, optimisticId);
      store.setDiagnostics(result.diagnostics);
      store.appendOutput({ jobId: result.jobId, phase: action, stream: result.success ? "system" : "stderr", message: result.success ? `Completed in ${(result.durationMs / 1000).toFixed(1)}s` : result.failureMessage ?? `${action} did not complete. Open Problems for details.`, timestamp: new Date().toISOString() });
      store.setBuild(await bridge.buildSummary(store.root, store.projectPath));
      if (result.success && ["build", "upload", "flash"].includes(action)) {
        await bridge.recordSnapshot(store.root, store.projectPath, "baseline").catch(() => undefined);
      }
      window.dispatchEvent(new Event("fpga-studio:analysis-refresh"));
      window.dispatchEvent(new Event("fpga-studio:verification-refresh"));
      window.dispatchEvent(new Event("fpga-studio:intelligence-refresh"));
      window.dispatchEvent(new Event("fpga-studio:analyzer-refresh"));
      window.dispatchEvent(new Event("fpga-studio:health-refresh"));
      return result.success;
    } catch (error) {
      store.appendOutput({ jobId: optimisticId, phase: action, stream: "stderr", message: error instanceof Error ? error.message : String(error), timestamp: new Date().toISOString() });
      return false;
    } finally {
      store.setRunningJob(null);
      runLock.current = false;
    }
  }, [store]);

  const save = useCallback(async () => {
    if (saveLock.current) return;
    const active = store.tabs.find((tab) => tab.path === store.activePath);
    if (!active) return;
    if (active.externalContent !== undefined && !window.confirm("This file changed on disk. Replace the disk version with your editor contents?")) return;
    saveLock.current = true;
    try {
      await bridge.writeText(store.root, active.path, active.content);
      store.markSaved(active.path, active.content);
      store.appendOutput({ jobId: "editor", phase: "save", stream: "system", message: `Saved ${active.path}`, timestamp: new Date().toISOString() });
      window.dispatchEvent(new Event("fpga-studio:analysis-refresh"));
      window.dispatchEvent(new Event("fpga-studio:verification-refresh"));
      window.dispatchEvent(new Event("fpga-studio:intelligence-refresh"));
    } catch (error) {
      store.setBottomPanel("output");
      store.appendOutput({ jobId: "editor", phase: "save", stream: "stderr", message: `Could not save ${active.path}: ${error instanceof Error ? error.message : String(error)}`, timestamp: new Date().toISOString() });
    } finally {
      saveLock.current = false;
    }
  }, [store]);

  const stop = useCallback(async () => {
    try { if (store.runningJob) await bridge.cancel(store.runningJob); }
    catch (error) { store.appendOutput({ jobId: "cancel", phase: "cancel", stream: "stderr", message: String(error), timestamp: new Date().toISOString() }); }
  }, [store.runningJob]);

  const content = store.view === "editor"
    ? <EditorWorkspace />
    : store.view === "verification"
      ? <VerificationView onRun={(action) => void run(action)} />
      : store.view === "analyzer"
        ? <LogicAnalyzerView onRun={run} />
        : store.view === "health"
          ? <DesignHealthView onRun={run} />
          : (() => { const View = viewComponents[store.view]; return <View />; })();
  return <><div className="app-shell" style={panelLayoutStyle(layout)}>
    {runtimeError && <div className="runtime-notice" role="alert"><span>{runtimeError}</span><button onClick={() => { store.setBottomPanel("output"); setRuntimeError(null); }}>Show output</button><button aria-label="Dismiss error" onClick={() => setRuntimeError(null)}>Dismiss</button></div>}
    <ErrorBoundary label="Menu" compact><TitleBar onRun={(action) => void run(action)} onSave={() => void save()} /></ErrorBoundary>
    <div className="workbench-shell">
      <ErrorBoundary label="Navigation" compact><ActivityBar /></ErrorBoundary>
      {store.sidebarOpen && <><ErrorBoundary label="Sidebar" resetKey={store.projectPath} compact><Sidebar /></ErrorBoundary><PanelResizeHandle panel="sidebar"/></>}
      <main className="main-area">
        <ErrorBoundary label="Toolbar" compact><CommandBar onRun={(action) => void run(action)} onSave={() => void save()} onStop={() => void stop()} /></ErrorBoundary>
        <div className="content-and-dock"><div className="content-surface"><ErrorBoundary label="Workspace view" resetKey={`${store.projectPath}/${store.view}`}>{content}</ErrorBoundary></div><ErrorBoundary label="Output panel" resetKey={store.bottomPanel} compact><BottomDock /></ErrorBoundary></div>
      </main>
      {store.aiPanelOpen && <ErrorBoundary label="Assistant"><AiPanel /></ErrorBoundary>}
    </div>
    <ErrorBoundary label="Status bar" compact><StatusBar /></ErrorBoundary>
  </div><ErrorBoundary label="Change review"><ProjectChangeReview/></ErrorBoundary><ErrorBoundary label="Open project" compact><OpenProjectDialog /></ErrorBoundary><ErrorBoundary label="Project dialog" compact><ProjectWizard /></ErrorBoundary><ErrorBoundary label="Release notes" compact><ReleaseNotes /></ErrorBoundary><ErrorBoundary label="Command dialog" compact><QuickLauncher onRun={(action) => void run(action)} onSave={() => void save()} /></ErrorBoundary></>;
}

export function App(): React.JSX.Element {
  return <ErrorBoundary><Workbench /></ErrorBoundary>;
}
