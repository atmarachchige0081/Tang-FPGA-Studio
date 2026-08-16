import { useEffect, useMemo, useState } from "react";
import { Activity, Bug, CircuitBoard, FilePlus2, ListChecks, Moon, Network, Play, Radio, Save, ScanSearch, Search, Sun, Waves, X } from "lucide-react";
import { useWorkbench } from "../store/workbench";
import type { BuildAction, WorkbenchView } from "../types";

interface Props {
  onRun: (action: BuildAction) => void;
  onSave: () => void;
}

interface LauncherAction {
  id: string;
  label: string;
  detail: string;
  group: "Recommended" | "Project" | "Build" | "Explore" | "Appearance";
  icon: typeof Search;
  keywords: string;
  run: () => void;
}

const launcherEvent = "fpga-studio:command-center";

export function openQuickLauncher(): void {
  window.dispatchEvent(new Event(launcherEvent));
}

export function QuickLauncher({ onRun, onSave }: Props): React.JSX.Element | null {
  const store = useWorkbench();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    const reveal = () => { setOpen(true); setQuery(""); setSelected(0); };
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        reveal();
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener(launcherEvent, reveal);
    window.addEventListener("keydown", shortcut);
    return () => { window.removeEventListener(launcherEvent, reveal); window.removeEventListener("keydown", shortcut); };
  }, []);

  const go = (view: WorkbenchView) => { store.setView(view); setOpen(false); };
  const execute = (action: LauncherAction) => { action.run(); setOpen(false); };
  const recommended: LauncherAction = store.diagnostics.some((item) => item.severity === "error")
    ? { id: "problems", label: "Review errors before continuing", detail: "Open Problems and fix the first reported issue", group: "Recommended", icon: Bug, keywords: "errors problems diagnostics fix", run: () => store.setBottomPanel("problems") }
    : store.build?.status === "passed"
      ? { id: "verification-next", label: "Review the verification evidence", detail: "Your latest build passed; check freshness, JTAG, and hardware stages", group: "Recommended", icon: ListChecks, keywords: "verification pipeline evidence hardware", run: () => go("verification") }
      : { id: "simulate-next", label: "Simulate before building", detail: "Fastest way to catch logic mistakes and inspect signals", group: "Recommended", icon: Play, keywords: "simulation beginner next verify", run: () => onRun("sim") };

  const actions = useMemo<LauncherAction[]>(() => [
    recommended,
    { id: "new", label: "Create a verified FPGA project", detail: "Choose a board-aware beginner template", group: "Project", icon: FilePlus2, keywords: "new create template board", run: store.openProjectWizard },
    { id: "save", label: "Save active source file", detail: "Write the current editor tab to disk", group: "Project", icon: Save, keywords: "save file ctrl s", run: onSave },
    { id: "lint", label: "Lint HDL", detail: "Check syntax without running synthesis", group: "Build", icon: Bug, keywords: "lint syntax errors", run: () => onRun("lint") },
    { id: "simulate", label: "Run simulation", detail: "Execute the self-checking testbench", group: "Build", icon: Play, keywords: "sim testbench iverilog", run: () => onRun("sim") },
    { id: "build", label: "Build bitstream", detail: "Synthesize, place, route, and pack", group: "Build", icon: Activity, keywords: "build synthesize pnr bitstream", run: () => onRun("build") },
    { id: "insights", label: "Open build insights", detail: "Timing, utilization, and build history", group: "Explore", icon: Activity, keywords: "dashboard timing resources", run: () => go("dashboard") },
    { id: "analysis", label: "Analyze RTL architecture", detail: "Provable HDL findings, hierarchy, clocks, and resets", group: "Explore", icon: ScanSearch, keywords: "analysis intelligence modules clocks reset findings", run: () => go("analysis") },
    { id: "verification", label: "Open verification center", detail: "Honest pass, fail, warning, and not-run evidence", group: "Explore", icon: ListChecks, keywords: "verification pipeline evidence stages", run: () => go("verification") },
    { id: "health", label: "Open Design Health", detail: "Evidence-backed recommendations, experiments, and regressions", group: "Explore", icon: Activity, keywords: "health optimization snapshot regression experiment", run: () => go("health") },
    { id: "traceability", label: "Open Traceability Explorer", detail: "Follow RTL through netlist, timing, placement, and probes", group: "Explore", icon: Network, keywords: "trace rtl netlist physical bel timing path evidence", run: () => go("traceability") },
    { id: "analyzer", label: "Open Hardware Analyzer", detail: "Select internal probes, triggers, and capture physical signals", group: "Explore", icon: Waves, keywords: "logic analyzer ila probe trigger capture uart", run: () => go("analyzer") },
    { id: "waveform", label: "Open waveform viewer", detail: "Inspect real VCD signals and scopes", group: "Explore", icon: Waves, keywords: "wave vcd signal simulation", run: () => go("waveform") },
    { id: "netlist", label: "Open netlist viewer", detail: "Explore synthesized cells and connections", group: "Explore", icon: Network, keywords: "netlist yosys cells schematic", run: () => go("netlist") },
    { id: "hardware", label: "Open hardware manager", detail: "Discover JTAG and serial interfaces", group: "Explore", icon: CircuitBoard, keywords: "board jtag device detect", run: () => go("hardware") },
    { id: "uart", label: "Open UART terminal", detail: "Talk to the friendly serial command project", group: "Explore", icon: Radio, keywords: "serial uart terminal com", run: () => go("uart") },
    { id: "theme", label: store.theme === "light" ? "Switch to dark theme" : "Switch to light theme", detail: "High-contrast editor and interface colors", group: "Appearance", icon: store.theme === "light" ? Moon : Sun, keywords: "theme dark light appearance", run: () => store.setTheme(store.theme === "light" ? "dark" : "light") },
  ], [recommended, store.theme, store.openProjectWizard, onRun, onSave]);

  const normalized = query.trim().toLowerCase();
  const filtered = actions.filter((action) => !normalized || `${action.label} ${action.detail} ${action.keywords}`.toLowerCase().includes(normalized));
  const safeSelected = Math.min(selected, Math.max(0, filtered.length - 1));
  if (!open) return null;

  return <div className="launcher-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
    <section className="quick-launcher" role="dialog" aria-modal="true" aria-label="FPGA Studio action center">
      <div className="launcher-search"><Search size={18}/><input autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setSelected(0); }} onKeyDown={(event) => {
        if (event.key === "ArrowDown") { event.preventDefault(); setSelected((value) => filtered.length ? (value + 1) % filtered.length : 0); }
        if (event.key === "ArrowUp") { event.preventDefault(); setSelected((value) => filtered.length ? (value - 1 + filtered.length) % filtered.length : 0); }
        if (event.key === "Enter" && filtered[safeSelected]) execute(filtered[safeSelected]);
      }} placeholder="Search actions, views, and learning tools…" aria-label="Search actions"/><kbd>ESC</kbd><button onClick={() => setOpen(false)} aria-label="Close action center"><X size={16}/></button></div>
      <div className="launcher-results">{filtered.length ? filtered.map((action, index) => {
        const Icon = action.icon;
        const showGroup = index === 0 || filtered[index - 1]?.group !== action.group;
        return <div className="launcher-entry" key={action.id}>{showGroup && <span className="launcher-group">{action.group}</span>}<button className={index === safeSelected ? "selected" : ""} onMouseEnter={() => setSelected(index)} onClick={() => execute(action)}><span className="launcher-icon"><Icon size={17}/></span><span><strong>{action.label}</strong><small>{action.detail}</small></span>{action.group === "Recommended" && <i>SMART NEXT STEP</i>}</button></div>;
      }) : <div className="launcher-empty"><Search size={24}/><strong>No matching action</strong><span>Try “simulate”, “UART”, “board”, or “theme”.</span></div>}</div>
      <footer><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>Enter</kbd> run</span><span>All actions stay local to this workspace.</span></footer>
    </section>
  </div>;
}
