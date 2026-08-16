import { useCallback, useEffect, useRef } from "react";
import { ActivityBar } from "./components/ActivityBar";
import { BottomDock } from "./components/BottomDock";
import { CommandBar } from "./components/CommandBar";
import { EditorWorkspace } from "./components/EditorWorkspace";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { TitleBar } from "./components/TitleBar";
import { ProjectWizard } from "./components/ProjectWizard";
import { ReleaseNotes } from "./components/ReleaseNotes";
import { QuickLauncher } from "./components/QuickLauncher";
import { DashboardView, HardwareView, NetlistView, UartView, WaveformView, WelcomeView } from "./components/WorkbenchViews";
import { AnalysisView } from "./components/AnalysisView";
import { VerificationView } from "./components/VerificationView";
import { DesignHealthView, LogicAnalyzerView, TraceabilityView } from "./components/HardwareIntelligence";
import { bridge } from "./lib/bridge";
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
  const runLock = useRef(false);
  const documentationCaptureApplied = useRef(false);

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
    };
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  }, [store.theme]);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      const snapshot = await bridge.workspaceSnapshot();
      if (disposed) return;
      store.setWorkspace(snapshot.root, snapshot.project, snapshot.projectPath, snapshot.tree);
      const [summary, board] = await Promise.all([
        bridge.buildSummary(snapshot.root, snapshot.projectPath),
        bridge.activeBoard(snapshot.root, snapshot.projectPath),
      ]);
      if (!disposed) { store.setBuild(summary); store.setBoard(board); }
      void bridge.gitStatus(snapshot.root).then((status) => { if (!disposed) store.setGit(status); }).catch(() => undefined);
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
    };
    const requestedView = captureViews[capture];
    if (requestedView) store.setView(requestedView);
    if ((capture === "analysis" || capture === "verification") && store.bottomOpen) store.toggleBottom();
    if (capture === "launcher") {
      window.setTimeout(() => window.dispatchEvent(new Event("fpga-studio:command-center")), 150);
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
    const active = store.tabs.find((tab) => tab.path === store.activePath);
    if (!active) return;
    await bridge.writeText(store.root, active.path, active.content);
    store.markSaved(active.path);
    store.appendOutput({ jobId: "editor", phase: "save", stream: "system", message: `Saved ${active.path}`, timestamp: new Date().toISOString() });
    window.dispatchEvent(new Event("fpga-studio:analysis-refresh"));
    window.dispatchEvent(new Event("fpga-studio:verification-refresh"));
  }, [store]);

  const stop = useCallback(async () => {
    if (store.runningJob) await bridge.cancel(store.runningJob);
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
  return <><div className="app-shell">
    <TitleBar onRun={(action) => void run(action)} onSave={() => void save()} />
    <div className="workbench-shell">
      <ActivityBar />
      {store.sidebarOpen && <Sidebar />}
      <main className="main-area">
        <CommandBar onRun={(action) => void run(action)} onSave={() => void save()} onStop={() => void stop()} />
        <div className="content-and-dock"><div className="content-surface">{content}</div><BottomDock /></div>
      </main>
    </div>
    <StatusBar />
  </div><ProjectWizard /><ReleaseNotes /><QuickLauncher onRun={(action) => void run(action)} onSave={() => void save()} /></>;
}

export function App(): React.JSX.Element {
  return <ErrorBoundary><Workbench /></ErrorBoundary>;
}
