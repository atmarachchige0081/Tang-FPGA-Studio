import { useEffect, useMemo, useRef, useState } from "react";
import { Background, Controls, Handle, MiniMap, Position, ReactFlow, type NodeProps } from "@xyflow/react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowRight, BookOpen, Box, Cable, CheckCircle2, ChevronRight, CircuitBoard, Clock3, Cpu, ExternalLink, FolderOpen, Gauge, Lightbulb, Maximize2, MemoryStick, Minus, Network, Play, Plus, RefreshCw, Search, ShieldCheck, Sparkles, TerminalSquare, Waves, Zap } from "lucide-react";
import { bridge } from "../lib/bridge";
import { needsJtagDriverRepair } from "../lib/hardware";
import { busPaths, formatSignalValue, formatVcdTime, scalarPoints, visibleTransitions, type WaveWindow } from "../lib/waveform";
import { useWorkbench } from "../store/workbench";
import type { BuildHistoryEntry, NetlistGraph, SerialDevice, WaveformData } from "../types";

function Metric({ label, value, note, icon: Icon, accent = "blue" }: { label: string; value: string; note: string; icon: typeof Cpu; accent?: string }): React.JSX.Element {
  return <article className={`metric-card accent-${accent}`}><div className="metric-icon"><Icon size={18} /></div><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div></article>;
}

export function DashboardView(): React.JSX.Element {
  const build = useWorkbench((state) => state.build);
  const root = useWorkbench((state) => state.root);
  const project = useWorkbench((state) => state.projectPath);
  const [history, setHistory] = useState<BuildHistoryEntry[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const loadHistory = async () => { try { setHistory(await bridge.buildHistory(root, project)); setHistoryError(null); } catch (reason) { setHistoryError(reason instanceof Error ? reason.message : String(reason)); } };
  useEffect(() => { if (root) void loadHistory(); }, [root, project, build?.updatedAt]);
  const lutPercent = build?.lutUsed != null && build.lutTotal ? Math.round(build.lutUsed / build.lutTotal * 100) : 0;
  const chartHistory = history.filter((entry) => entry.action === "build" && entry.fmaxMHz != null).slice(-12).map((entry) => ({ name: `#${entry.buildNumber}`, fmax: entry.fmaxMHz, lut: entry.lutUsed }));
  const resourceData = (build?.resources ?? []).filter((resource) => resource.used > 0 || ["LUT4", "DFF", "BSRAM", "IOB", "rPLL"].includes(resource.name)).slice(0, 8).map((resource) => ({ type: resource.name, used: resource.used, free: Math.max(0, resource.total - resource.used) }));
  return <section className="feature-view dashboard-view">
    <div className="feature-header"><div><p className="eyebrow">Design intelligence</p><h1>Implementation overview</h1><p>Timing, utilization, and build health for the active project.</p></div><button className="secondary-button" onClick={() => void loadHistory()}><RefreshCw size={15} /> Refresh analytics</button></div>
    <div className="metric-grid">
      <Metric label="Maximum frequency" value={build?.fmaxMHz ? `${build.fmaxMHz.toFixed(1)} MHz` : "Not built"} note={`Target ${build?.targetMHz?.toFixed(0) ?? 27} MHz`} icon={Gauge} accent="cyan" />
      <Metric label="Logic utilization" value={build?.lutUsed != null ? `${build.lutUsed.toLocaleString()} LUTs` : "—"} note={build?.lutTotal ? `${lutPercent}% of device` : "Run Build to measure"} icon={Cpu} accent="violet" />
      <Metric label="Worst slack" value={build?.worstSlackNs != null ? `${build.worstSlackNs >= 0 ? "+" : ""}${build.worstSlackNs.toFixed(2)} ns` : "—"} note={build?.worstSlackNs == null ? "No timing report" : build.worstSlackNs >= 0 ? "Timing passes" : "Timing violation"} icon={Clock3} accent={build?.worstSlackNs != null && build.worstSlackNs < 0 ? "amber" : "green"} />
      <Metric label="Bitstream" value={build?.bitstreamBytes ? `${Math.round(build.bitstreamBytes / 1024)} KiB` : "—"} note={build?.bitstreamBytes ? "Generated locally" : "No bitstream yet"} icon={MemoryStick} accent="amber" />
    </div>
    <div className="chart-grid">
      <article className="panel-card"><div className="card-title"><div><h2>Timing trend</h2><p>Maximum frequency across recorded builds</p></div>{build?.worstSlackNs != null && <span className={build.worstSlackNs >= 0 ? "status-good" : "status-warn"}>{build.worstSlackNs >= 0 && <CheckCircle2 size={13} />} {build.worstSlackNs >= 0 ? "passing" : "violation"}</span>}</div><div className="chart-wrap">{chartHistory.length ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={chartHistory}><defs><linearGradient id="freqFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--accent)" stopOpacity={0.45}/><stop offset="100%" stopColor="var(--accent)" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="var(--line-subtle)" vertical={false}/><XAxis dataKey="name" stroke="var(--text-muted)" fontSize={11}/><YAxis stroke="var(--text-muted)" fontSize={11}/><Tooltip contentStyle={{ background: "var(--surface-raised)", border: "1px solid var(--line)", borderRadius: 8 }}/><Area type="monotone" dataKey="fmax" stroke="var(--accent)" fill="url(#freqFill)" strokeWidth={2}/></AreaChart></ResponsiveContainer> : <div className="chart-empty">Run Build from the toolbar to start a timing trend.</div>}</div></article>
      <article className="panel-card"><div className="card-title"><div><h2>Resource profile</h2><p>Current device occupancy</p></div><Cpu size={17}/></div><div className="chart-wrap">{build?.lutTotal || build?.registersTotal ? <ResponsiveContainer width="100%" height="100%"><BarChart data={resourceData}><CartesianGrid stroke="var(--line-subtle)" vertical={false}/><XAxis dataKey="type" stroke="var(--text-muted)" fontSize={11}/><YAxis hide/><Tooltip contentStyle={{ background: "var(--surface-raised)", border: "1px solid var(--line)", borderRadius: 8 }}/><Bar dataKey="used" stackId="a" fill="var(--purple)" radius={[0,0,3,3]}/><Bar dataKey="free" stackId="a" fill="var(--surface-hover)" radius={[3,3,0,0]}/></BarChart></ResponsiveContainer> : <div className="chart-empty">No utilization report is available yet.</div>}</div></article>
    </div>
    <div className="implementation-detail-grid">
      <article className="panel-card"><div className="card-title"><div><h2>Clock constraints</h2><p>Every clock reported by nextpnr</p></div><Clock3 size={17}/></div><div className="clock-table">{build?.clocks.length ? build.clocks.map((clock) => <div className="clock-row" key={clock.name}><span className={clock.timingMet ? "clock-pass" : "clock-fail"}>{clock.timingMet ? <CheckCircle2 size={14}/> : <Zap size={14}/>}</span><code>{clock.name}</code><span><small>target</small>{clock.constraintMHz.toFixed(2)} MHz</span><span><small>achieved</small>{clock.achievedMHz.toFixed(2)} MHz</span><strong className={clock.slackNs >= 0 ? "positive" : "negative"}>{clock.slackNs >= 0 ? "+" : ""}{clock.slackNs.toFixed(3)} ns</strong></div>) : <div className="empty-small">No constrained clocks are present in the implementation report.</div>}</div></article>
      <article className="panel-card"><div className="card-title"><div><h2>Device resources</h2><p>Complete reported utilization</p></div><Cpu size={17}/></div><div className="resource-table">{build?.resources.length ? build.resources.map((resource) => { const percent = resource.total ? resource.used / resource.total * 100 : 0; return <div className="resource-row" key={resource.name}><div><strong>{resource.label}</strong><code>{resource.name}</code></div><div className="resource-meter"><span style={{ width: `${Math.min(100, percent)}%` }}/></div><span>{resource.used.toLocaleString()} / {resource.total.toLocaleString()}</span><strong>{percent.toFixed(percent < 1 ? 1 : 0)}%</strong></div>; }) : <div className="empty-small">Run Build to collect device utilization.</div>}</div></article>
    </div>
    <article className="panel-card critical-path-card"><div className="card-title"><div><h2>Critical paths</h2><p>Longest real place-and-route paths, ordered by delay</p></div><Network size={17}/></div>{build?.criticalPaths.length ? build.criticalPaths.map((path, index) => <div className="critical-path-row" key={`${path.source}:${path.destination}:${index}`}><span>#{index + 1}</span><div><code>{path.source}</code><ArrowRight size={13}/><code>{path.destination}</code><small>{path.segments} timing segments</small></div><strong>{path.delayNs.toFixed(3)} ns</strong><em className={(path.slackNs ?? 0) >= 0 ? "positive" : "negative"}>{path.slackNs == null ? "slack unavailable" : `${path.slackNs >= 0 ? "+" : ""}${path.slackNs.toFixed(3)} ns slack`}</em></div>) : <div className="empty-small">No critical path detail is available yet.</div>}</article>
    <article className="panel-card path-card"><div className="card-title"><div><h2>Recent jobs</h2><p>Local commands recorded for this project</p></div><span>{history.length} total</span></div>{historyError ? <div className="empty-small">{historyError}</div> : history.length ? history.slice(-5).reverse().map((entry) => <div className="path-row history-row" key={entry.buildNumber}><span className={`job-state ${entry.success ? "passed" : "failed"}`}>{entry.success ? "PASS" : "FAIL"}</span><code>#{entry.buildNumber} · {entry.action}</code><span>{new Date(entry.completedAt).toLocaleString()}</span><strong>{(entry.durationMs / 1000).toFixed(1)}s</strong></div>) : <div className="empty-small">No jobs have been run from FPGA Studio yet.</div>}</article>
  </section>;
}

function LogicNode({ data }: NodeProps): React.JSX.Element {
  const info = data as { label: string; kind: string; detail: string };
  return <div className="logic-node"><Handle type="target" position={Position.Left}/><div className="logic-kind">{info.kind}</div><strong>{info.label}</strong><small>{info.detail}</small><Handle type="source" position={Position.Right}/></div>;
}

export function NetlistView(): React.JSX.Element {
  const root = useWorkbench((state) => state.root);
  const project = useWorkbench((state) => state.projectPath);
  const appendOutput = useWorkbench((state) => state.appendOutput);
  const setBottomPanel = useWorkbench((state) => state.setBottomPanel);
  const [graph, setGraph] = useState<NetlistGraph | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try { setGraph(await bridge.readNetlist(root, project)); }
    catch (reason) { setGraph(null); setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (root) void load(); }, [root, project]);

  const build = async () => {
    const jobId = `netlist-build-${Date.now()}`;
    setBuilding(true);
    setBottomPanel("output");
    try {
      const result = await bridge.run(root, project, "build", jobId);
      appendOutput({ jobId, phase: "build", stream: result.success ? "system" : "stderr", message: result.success ? "Build passed; netlist reloaded." : result.failureMessage ?? "Build did not complete. Open Problems for details.", timestamp: new Date().toISOString() });
      if (result.success) await load();
    } catch (reason) {
      appendOutput({ jobId, phase: "build", stream: "stderr", message: reason instanceof Error ? reason.message : String(reason), timestamp: new Date().toISOString() });
    } finally { setBuilding(false); }
  };

  const visible = useMemo(() => {
    if (!graph) return [];
    const normalized = query.trim().toLowerCase();
    if (!normalized) return graph.nodes.slice(0, 250);
    const matches = new Set(graph.nodes.filter((node) => `${node.label} ${node.kind} ${node.detail}`.toLowerCase().includes(normalized)).map((node) => node.id));
    for (const edge of graph.edges) {
      if (matches.has(edge.source)) matches.add(edge.target);
      if (matches.has(edge.target)) matches.add(edge.source);
    }
    return graph.nodes.filter((node) => matches.has(node.id)).slice(0, 250);
  }, [graph, query]);
  const nodes = useMemo(() => {
    let input = 0; let output = 0; let cell = 0;
    return visible.map((node) => {
      let position: { x: number; y: number };
      if (node.kind === "INPUT" || node.kind === "INOUT") position = { x: 20, y: 45 + input++ * 105 };
      else if (node.kind === "OUTPUT") position = { x: 1020, y: 45 + output++ * 105 };
      else { position = { x: 250 + cell % 4 * 210, y: 45 + Math.floor(cell++ / 4) * 105 }; }
      return { id: node.id, position, data: { label: node.label, kind: node.kind, detail: node.detail }, type: "logic" as const };
    });
  }, [visible]);
  const edges = useMemo(() => {
    if (!graph) return [];
    const ids = new Set(visible.map((node) => node.id));
    const matching = graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)).slice(0, 800);
    return matching.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, label: edge.nets.slice(0, 2).join(", "), animated: matching.length <= 250 && edge.nets.some((net) => /clk|clock/i.test(net)) }));
  }, [graph, visible]);

  return <section className="feature-view graph-view"><div className="feature-header compact"><div><p className="eyebrow">Synthesized design</p><h1>Netlist explorer</h1></div><div className="header-actions"><label className="inline-search"><Search size={14}/><input aria-label="Search netlist" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find cell, type, or category" /></label><button className="secondary-button" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={15}/> Reload</button></div></div>{loading ? <div className="view-state"><RefreshCw className="spin" size={20}/><strong>Reading synthesized netlist…</strong></div> : error ? <div className="view-state error-state"><Network size={25}/><strong>No synthesized netlist available</strong><p>{error}</p><button className="primary-button" onClick={() => void build()} disabled={building}><Zap size={14}/> {building ? "Building…" : "Build design"}</button></div> : graph && <div className="graph-shell"><div className="graph-breadcrumb"><Box size={14}/> {graph.moduleName} <span>{graph.totalCells.toLocaleString()} cells · {graph.edges.length.toLocaleString()} connections · {graph.creator}{graph.truncated ? " · viewer safely truncated" : ""}</span></div><ReactFlow nodes={nodes} edges={edges} nodeTypes={{ logic: LogicNode }} fitView colorMode="system"><Background color="var(--line-subtle)"/><Controls/><MiniMap pannable zoomable nodeColor="var(--accent)"/></ReactFlow></div>}</section>;
}

const waveformColors = ["#5eead4", "#fbbf24", "#a78bfa", "#60a5fa", "#fb7185", "#4ade80", "#f97316", "#c084fc"];

export function WaveformView(): React.JSX.Element {
  const root = useWorkbench((state) => state.root);
  const project = useWorkbench((state) => state.projectPath);
  const appendOutput = useWorkbench((state) => state.appendOutput);
  const setBottomPanel = useWorkbench((state) => state.setBottomPanel);
  const [waveform, setWaveform] = useState<WaveformData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [query, setQuery] = useState("");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState(0);
  const [showAliases, setShowAliases] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try { setWaveform(await bridge.readWaveform(root, project)); setZoom(1); setPan(0); }
    catch (reason) { setWaveform(null); setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (root) void load(); }, [root, project]);
  const visibleSignals = useMemo(() => {
    if (!waveform) return [];
    const needle = query.trim().toLowerCase();
    const matching = waveform.signals.filter((signal) => !needle || `${signal.scope}.${signal.name}`.toLowerCase().includes(needle));
    if (showAliases) return matching.slice(0, 100);
    const identifiers = new Set<string>();
    return matching.filter((signal) => {
      if (identifiers.has(signal.id)) return false;
      identifiers.add(signal.id);
      return true;
    }).slice(0, 100);
  }, [waveform, query, showAliases]);
  const viewWindow = useMemo<WaveWindow>(() => {
    const total = Math.max(1, waveform?.endTime ?? 1);
    const duration = total / zoom;
    const start = (total - duration) * pan / 100;
    return { start, end: start + duration };
  }, [waveform, zoom, pan]);
  const changeZoom = (next: number) => {
    const safe = Math.max(1, Math.min(32, next));
    setZoom(safe);
    if (safe === 1) setPan(0);
  };
  const runSimulation = async () => {
    const jobId = `waveform-sim-${Date.now()}`;
    setRunning(true);
    setBottomPanel("output");
    try {
      const result = await bridge.run(root, project, "sim", jobId);
      appendOutput({ jobId, phase: "sim", stream: result.success ? "system" : "stderr", message: result.success ? "Simulation passed; waveform reloaded." : result.failureMessage ?? "Simulation did not complete. Open Problems for details.", timestamp: new Date().toISOString() });
      if (result.success) await load();
    } catch (reason) {
      appendOutput({ jobId, phase: "sim", stream: "stderr", message: reason instanceof Error ? reason.message : String(reason), timestamp: new Date().toISOString() });
    } finally { setRunning(false); }
  };

  const ruler = waveform ? Array.from({ length: 6 }, (_, index) => viewWindow.start + (viewWindow.end - viewWindow.start) * index / 5) : [];
  return <section className="feature-view waveform-view">
    <div className="feature-header compact"><div><p className="eyebrow">Simulation waveform</p><h1>{waveform?.path ?? "Waveform viewer"}</h1></div><div className="header-actions"><button className="secondary-button" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={14}/> Reload</button><button className="secondary-button" onClick={() => void runSimulation()} disabled={running}><Play size={14}/> {running ? "Simulating…" : "Run simulation"}</button></div></div>
    {loading ? <div className="view-state"><RefreshCw className="spin" size={20}/><strong>Reading VCD waveform…</strong></div> : error ? <div className="view-state error-state"><Waves size={24}/><strong>No waveform available</strong><p>{error}</p><button className="primary-button" onClick={() => void runSimulation()}><Play size={14}/> Generate waveform</button></div> : waveform && <>
      <div className="wave-tools">
        <label className="wave-search"><Search size={14}/><input aria-label="Find waveform signal" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find signal or scope" /></label>
        <button className={showAliases ? "active" : ""} onClick={() => setShowAliases((current) => !current)} title="Aliases are the same electrical signal declared in more than one VCD scope">{showAliases ? "Hide aliases" : "Show aliases"}</button>
        <span>{waveform.timescale} timescale</span><span className="wave-spacer"/>
        <div className="wave-zoom" aria-label="Waveform zoom controls"><button onClick={() => changeZoom(zoom / 2)} disabled={zoom === 1} title="Zoom out"><Minus size={13}/></button><span>{zoom}×</span><button onClick={() => changeZoom(zoom * 2)} disabled={zoom === 32} title="Zoom in"><Plus size={13}/></button><button onClick={() => changeZoom(1)} disabled={zoom === 1} title="Fit the complete simulation"><Maximize2 size={12}/> Fit</button></div>
        <span className="cursor-readout">{visibleSignals.length}/{waveform.signals.length} signals</span>{waveform.truncated && <span className="status-warn">sample limit reached</span>}
      </div>
      {zoom > 1 && <div className="wave-pan"><span>{formatVcdTime(viewWindow.start, waveform.timescale, viewWindow.end - viewWindow.start)} – {formatVcdTime(viewWindow.end, waveform.timescale, viewWindow.end - viewWindow.start)}</span><input aria-label="Pan waveform timeline" type="range" min="0" max="100" step="0.1" value={pan} onChange={(event) => setPan(Number(event.target.value))}/></div>}
      <div className="wave-shell">
        <div className="signal-list"><div className="signal-header">SIGNALS <span>VALUE</span></div>{visibleSignals.map((signal, index) => <div className="signal-row" key={`${signal.scope}:${signal.name}:${index}`} title={`${signal.scope}.${signal.name}`}><span className="signal-color" style={{ background: waveformColors[index % waveformColors.length] }}/><span className="signal-copy"><code>{signal.name}</code><small>{signal.scope || "top"}</small></span><small className="signal-value">{formatSignalValue(signal, viewWindow.end)}</small></div>)}</div>
        <div className="wave-canvas"><div className="time-ruler">{ruler.map((time, index) => <span key={index}>{formatVcdTime(time, waveform.timescale, viewWindow.end - viewWindow.start)}</span>)}</div>{visibleSignals.map((signal, index) => {
          const color = waveformColors[index % waveformColors.length];
          const key = `${signal.scope}:${signal.name}:${index}`;
          const dense = visibleTransitions(signal, viewWindow) > 240;
          if (dense) return <div className="wave-row" key={key}><svg viewBox="0 0 480 38" preserveAspectRatio="none" className="dense-wave"><defs><pattern id={`dense-${index}`} width="6" height="38" patternUnits="userSpaceOnUse"><path d="M0 7 V30" stroke={color} strokeWidth="1" opacity=".55"/></pattern></defs><path d="M0 7 H480 M0 30 H480" stroke={color} strokeWidth="1.5" fill="none" vectorEffect="non-scaling-stroke"/><rect x="0" y="7" width="480" height="23" fill={`url(#dense-${index})`}/></svg><span className="dense-label" style={{ color }}>dense {signal.width > 1 ? "bus" : "clock"} · zoom in</span></div>;
          if (signal.width > 1) {
            const paths = busPaths(signal, viewWindow);
            return <div className="wave-row" key={key}><svg viewBox="0 0 480 38" preserveAspectRatio="none"><path d={paths.top} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke"/><path d={paths.bottom} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke"/></svg></div>;
          }
          return <div className="wave-row" key={key}><svg viewBox="0 0 480 38" preserveAspectRatio="none"><polyline points={scalarPoints(signal, viewWindow)} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke"/></svg></div>;
        })}</div>
      </div>
    </>}
  </section>;
}

export function HardwareView(): React.JSX.Element {
  const root = useWorkbench((state) => state.root);
  const project = useWorkbench((state) => state.projectPath);
  const appendOutput = useWorkbench((state) => state.appendOutput);
  const setBottomPanel = useWorkbench((state) => state.setBottomPanel);
  const board = useWorkbench((state) => state.board);
  const [profiles, setProfiles] = useState<import("../types").BoardProfile[]>([]);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [devices, setDevices] = useState<SerialDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [jtag, setJtag] = useState<"unchecked" | "checking" | "ready" | "blocked">("unchecked");
  const [driverState, setDriverState] = useState<"idle" | "launching" | "opened" | "failed">("idle");
  const [driverError, setDriverError] = useState<string | null>(null);
  const scan = async () => { setScanning(true); setScanError(null); try { setDevices(await bridge.serialDevices()); } catch (reason) { setScanError(reason instanceof Error ? reason.message : String(reason)); } finally { setScanning(false); } };
  useEffect(() => { void scan(); }, []);
  useEffect(() => {
    if (!root) return;
    let disposed = false;
    void bridge.boards(root).then((items) => { if (!disposed) { setProfiles(items); setProfileError(null); } }).catch((reason: unknown) => { if (!disposed) setProfileError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { disposed = true; };
  }, [root]);
  const canRepairJtagDriver = board?.programmer.usbVid === "0403" && board?.programmer.usbPid === "6010" && board?.programmer.jtagInterface === 0;

  const openDriver = async (automatic = false) => {
    const jobId = `jtag-driver-${Date.now()}`;
    setDriverState("launching");
    setDriverError(null);
    setBottomPanel("output");
    appendOutput({ jobId, phase: "driver", stream: "system", message: automatic ? "Windows can see the programmer but cannot open JTAG Interface 0. Opening the verified Zadig repair helper…" : "Opening the verified Zadig repair helper…", timestamp: new Date().toISOString() });
    try {
      const message = await bridge.launchZadig(root, project);
      setDriverState("opened");
      appendOutput({ jobId, phase: "driver", stream: "system", message, timestamp: new Date().toISOString() });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setDriverState("failed");
      setDriverError(message);
      appendOutput({ jobId, phase: "driver", stream: "stderr", message: `Zadig could not be opened automatically: ${message}`, timestamp: new Date().toISOString() });
    }
  };

  const detect = async () => {
    const jobId = `jtag-detect-${Date.now()}`;
    setJtag("checking");
    setDriverState("idle");
    setDriverError(null);
    setBottomPanel("output");
    try {
      const result = await bridge.run(root, project, "detect", jobId);
      setJtag(result.success ? "ready" : "blocked");
      appendOutput({ jobId, phase: "detect", stream: result.success ? "system" : "stderr", message: result.success ? "JTAG chain detected successfully." : canRepairJtagDriver ? `JTAG detection failed for ${board?.name ?? "the active board"}. Verify that only Interface 0 uses WinUSB; Interface 1 must remain the UART.` : `JTAG detection failed for ${board?.name ?? "the active board"}. Check its programmer connection and board package.`, timestamp: new Date().toISOString() });
      if (needsJtagDriverRepair(result) && canRepairJtagDriver) await openDriver(true);
    } catch (reason) {
      setJtag("blocked");
      appendOutput({ jobId, phase: "detect", stream: "stderr", message: reason instanceof Error ? reason.message : String(reason), timestamp: new Date().toISOString() });
    }
  };
  const usbPresent = devices.some((device) => device.likelyBoard);
  const jtagLabel = jtag === "ready" ? "JTAG verified" : jtag === "checking" ? "Checking JTAG…" : jtag === "blocked" ? "JTAG needs attention" : "JTAG not checked";
  const driverStatus = driverState === "launching" ? "Opening verified Zadig…" : driverState === "opened" ? "Zadig is open" : driverState === "failed" ? "Automatic launch failed" : "Repair available";
  return <section className="feature-view">
    <div className="feature-header"><div><p className="eyebrow">Connected systems</p><h1>Hardware manager</h1><p>Inspect programmers, target boards, and serial interfaces before programming.</p></div><button className="primary-button" onClick={() => void scan()} disabled={scanning}><RefreshCw className={scanning ? "spin" : ""} size={15}/> Scan devices</button></div>
    {jtag === "blocked" && canRepairJtagDriver && <article className="driver-guidance">
      <ShieldCheck size={22}/><div className="driver-guide-body"><div className="driver-guide-title"><div><h3>Repair JTAG Interface 0</h3><p>FPGA Studio detected the Windows driver problem and launches the verified Zadig helper automatically.</p></div><span className={`driver-state ${driverState}`}>{driverState === "launching" && <RefreshCw className="spin" size={12}/>} {driverStatus}</span></div>
      <ol><li>In Zadig, open <strong>Options → List All Devices</strong>.</li><li>Select <strong>JTAG Debugger (Interface 0)</strong> or <strong>USB Serial Converter A</strong>.</li><li>Confirm it is <strong>Interface 0 / MI_00</strong> with USB ID <code>0403:6010</code>.</li><li>Choose <strong>WinUSB</strong>, then click <strong>Replace Driver</strong>.</li><li>Close Zadig and click <strong>Detect again</strong> below.</li></ol>
      <div className="driver-safety"><ShieldCheck size={15}/><span><strong>Never select Interface 1 / MI_01.</strong> It supplies the UART COM port and should keep its FTDI serial driver.</span></div>
      {driverError && <p className="driver-error">{driverError}</p>}
      <div className="driver-actions"><button className="secondary-button" onClick={() => void openDriver()} disabled={driverState === "launching"}><ExternalLink size={14}/> {driverState === "opened" ? "Open Zadig again" : "Open Zadig"}</button><button className="primary-button" onClick={() => void detect()} disabled={driverState === "launching"}><RefreshCw size={14}/> Detect again</button></div></div>
    </article>}
    <div className="hardware-grid">
      <article className="device-card featured"><div className="device-visual"><CircuitBoard size={42}/>{usbPresent && <span className="pulse-ring"/>}</div><div><span className={usbPresent ? "status-good" : "tag"}>{usbPresent ? "USB INTERFACE FOUND" : "BOARD PROFILE LOADED"}</span><h2>{board?.name ?? "Loading target board"}</h2><p>{board ? `${board.device} · ${board.logicCells?.toLocaleString() ?? "unknown"} LUT4` : "Reading project manifest..."}</p><div className="device-facts"><span><Clock3 size={14}/> {board?.clocks[0] ? `${board.clocks[0].frequencyHz / 1_000_000} MHz` : "--"}</span><span><Box size={14}/> {board?.build?.backend === "gowin-eda" ? "Gowin EDA" : "OSS CAD"}{board?.build?.deviceVersion ? ` · rev ${board.build.deviceVersion}` : ""}</span><span><Zap size={14}/> {board?.programmer.transport ?? "programmer"}</span><span className={jtag === "blocked" ? "fact-error" : jtag === "ready" ? "fact-good" : ""}><ShieldCheck size={14}/> {jtagLabel}</span></div></div><button className="secondary-button" onClick={() => void detect()} disabled={jtag === "checking" || driverState === "launching"}>{jtag === "checking" ? <RefreshCw className="spin" size={14}/> : <ArrowRight size={14}/>} Detect JTAG</button></article>
      <article className="panel-card"><div className="card-title"><div><h2>Serial interfaces</h2><p>Detected local COM endpoints</p></div><Cable size={19}/></div>{scanError ? <div className="empty-small">{scanError}</div> : devices.length ? devices.map((device) => <div className="interface-row" key={device.portName}><div className="port-icon"><TerminalSquare size={17}/></div><div><strong>{device.portName}</strong><span>{device.displayName}</span></div>{device.likelyBoard && <span className="tag">Likely board UART</span>}</div>) : <div className="empty-small">No serial devices detected.</div>}</article>
    </div>
    {jtag === "blocked" && !canRepairJtagDriver && <article className="safety-card warning"><ShieldCheck size={22}/><div><h3>Board-specific programmer check</h3><p>{board?.name ?? "This target"} does not declare the known dual-interface WinUSB repair flow, so FPGA Studio will not open Zadig automatically. Reconnect its onboard or external debugger, confirm the selected board package, and retry Detect.</p></div></article>}
    <article className="panel-card board-catalog"><div className="card-title"><div><h2>Installed Tang board packages</h2><p>Project creation enables only templates whose I/O matches the chosen board.</p></div><CircuitBoard size={19}/></div>{profileError ? <div className="empty-small">{profileError}</div> : <div className="board-profile-grid">{profiles.map((profile) => <div className={profile.id === board?.id ? "active" : ""} key={profile.id}><span>{profile.id === board?.id ? "ACTIVE" : profile.programmer.board}</span><strong>{profile.name}</strong><small>{profile.device} · {profile.clocks[0] ? `${profile.clocks[0].frequencyHz / 1_000_000} MHz` : "clock unknown"} · {profile.build?.backend === "gowin-eda" ? "Gowin EDA" : "OSS CAD"}{profile.build?.deviceVersion ? ` rev ${profile.build.deviceVersion}` : ""}</small></div>)}</div>}</article>
    <article className="safety-card"><ShieldCheck size={22}/><div><h3>Safe programming workflow</h3><p>SRAM upload is volatile. Flash persists after power-off and asks for confirmation before the write starts. FPGA Studio may open the verified driver helper, but it never selects a device or replaces a driver automatically.</p></div></article>
  </section>;
}

interface UartLine { time: string; direction: "rx" | "tx" | "status" | "error"; text: string }
interface UartSession { id: string; port: string; baud: number; connected: boolean; connecting: boolean; lines: UartLine[] }

export function UartView(): React.JSX.Element {
  const [devices, setDevices] = useState<SerialDevice[]>([]);
  const [sessions, setSessions] = useState<UartSession[]>([]);
  const sessionsRef = useRef<UartSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  const addSession = (ports = devices) => {
    const id = `uart-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const port = ports.find((device) => device.likelyBoard)?.portName ?? ports[0]?.portName ?? "";
    setSessions((current) => [...current, { id, port, baud: 115200, connected: false, connecting: false, lines: [] }]);
    setActiveId(id);
  };
  useEffect(() => {
    let disposed = false;
    void bridge.serialDevices().then((ports) => { if (!disposed) { setDevices(ports); setSessions((current) => { if (current.length) return current; const id = `uart-${Date.now()}`; setActiveId(id); return [{ id, port: ports.find((device) => device.likelyBoard)?.portName ?? ports[0]?.portName ?? "", baud: 115200, connected: false, connecting: false, lines: [] }]; }); } });
    let unlisten: (() => void) | undefined;
    void bridge.onSerialEvent((event) => {
      const text = event.kind === "data" ? new TextDecoder().decode(Uint8Array.from(event.data)) : event.message ?? "Serial event";
      setSessions((current) => current.map((session) => session.id === event.sessionId ? { ...session, connected: event.kind === "error" ? false : session.connected, lines: [...session.lines.slice(-999), { time: new Date(event.timestamp).toLocaleTimeString(), direction: event.kind === "data" ? "rx" : event.kind, text }] } : session));
    }).then((stop) => { if (disposed) stop(); else unlisten = stop; }).catch(() => undefined);
    return () => { disposed = true; unlisten?.(); for (const session of sessionsRef.current.filter((item) => item.connected)) void bridge.disconnectSerial(session.id); };
  }, []);
  const active = sessions.find((session) => session.id === activeId) ?? null;
  const updateActive = (values: Partial<UartSession>) => setSessions((current) => current.map((session) => session.id === activeId ? { ...session, ...values } : session));
  const toggleConnection = async () => {
    if (!active) return;
    if (active.connected) { await bridge.disconnectSerial(active.id); updateActive({ connected: false, connecting: false, lines: [...active.lines, { time: new Date().toLocaleTimeString(), direction: "status", text: "Disconnected" }] }); return; }
    if (!active.port) { updateActive({ lines: [...active.lines, { time: new Date().toLocaleTimeString(), direction: "error", text: "Select an available serial port first." }] }); return; }
    updateActive({ connecting: true });
    try { await bridge.connectSerial(active.port, active.baud, active.id); updateActive({ connected: true, connecting: false }); }
    catch (reason) { updateActive({ connected: false, connecting: false, lines: [...active.lines, { time: new Date().toLocaleTimeString(), direction: "error", text: reason instanceof Error ? reason.message : String(reason) }] }); }
  };
  const send = async (command = message) => {
    if (!active?.connected || !command) return;
    const text = `${command}\r\n`;
    try { await bridge.writeSerial(active.id, Array.from(new TextEncoder().encode(text))); updateActive({ lines: [...active.lines, { time: new Date().toLocaleTimeString(), direction: "tx", text: command }] }); setMessage(""); }
    catch (reason) { updateActive({ lines: [...active.lines, { time: new Date().toLocaleTimeString(), direction: "error", text: reason instanceof Error ? reason.message : String(reason) }] }); }
  };
  return <section className="feature-view uart-view">
    <div className="feature-header compact"><div><p className="eyebrow">Serial laboratory</p><h1>UART terminal</h1></div><button className="primary-button" onClick={() => addSession()}><Plus size={15}/> New connection</button></div>
    <div className="uart-tabs">{sessions.map((session, index) => <button key={session.id} className={session.id === activeId ? "active" : ""} onClick={() => setActiveId(session.id)}><span className={session.connected ? "online-dot" : "offline-dot"}/> Terminal {index + 1}<small>{session.port || "No port"}</small></button>)}</div>
    {active ? <>
      <div className="uart-toolbar">
        <label>Port <select value={active.port} disabled={active.connected || active.connecting} onChange={(event) => updateActive({ port: event.target.value })}><option value="">Select port</option>{devices.map((device) => <option key={device.portName} value={device.portName}>{device.portName} — {device.displayName}</option>)}</select></label>
        <label>Baud <select value={active.baud} disabled={active.connected || active.connecting} onChange={(event) => updateActive({ baud: Number(event.target.value) })}><option>9600</option><option>57600</option><option>115200</option><option>921600</option></select></label>
        <span>8 data · none · 1 stop</span>
        <button className={`connect-button ${active.connected ? "connected" : ""}`} onClick={() => void toggleConnection()} disabled={active.connecting}><span className={active.connected ? "online-dot" : "offline-dot"}/> {active.connecting ? "Connecting…" : active.connected ? "Disconnect" : "Connect"}</button>
      </div>
      <div className="uart-command-guide"><span><Sparkles size={13}/> Beginner command pad</span>{["HELP", "PING", "LED ON", "LED OFF", "STATUS", "ABOUT"].map((command) => <button key={command} disabled={!active.connected} onClick={() => void send(command)}>{command}</button>)}</div>
      <div className="terminal-screen">{active.lines.length ? active.lines.map((line, index) => <div className={`terminal-line ${line.direction === "status" ? "muted" : line.direction}`} key={`${line.time}-${index}`}>{line.direction !== "status" && <span>{line.direction.toUpperCase()}</span>}[{line.time}] {line.text}</div>) : <div className="terminal-placeholder">Disconnected. Select the board UART port, normally Interface 1, then press Connect.</div>}<div className="terminal-cursor">▌</div></div>
      <div className="terminal-input"><span>&gt;</span><input aria-label="UART message" value={message} disabled={!active.connected} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void send(); }} placeholder={active.connected ? "Type a message, Enter to send" : "Connect a serial port to send data"}/><button onClick={() => void send()} disabled={!active.connected || !message}>Send</button></div>
    </> : <div className="view-state"><TerminalSquare size={22}/><strong>No UART terminal open</strong><button className="primary-button" onClick={() => addSession()}><Plus size={14}/> New connection</button></div>}
  </section>;
}

export function WelcomeView(): React.JSX.Element {
  const { setView, setActivity, openProjectWizard, project, projectPath, board, build, root, recentProjects, setWorkspace, setBuild, setBoard, appendOutput } = useWorkbench();
  const switchProject = async (path: string) => {
    try {
      const snapshot = await bridge.openProject(root, path);
      setWorkspace(snapshot.root, snapshot.project, snapshot.projectPath, snapshot.tree, snapshot.recentProjects);
      const [summary, active] = await Promise.all([bridge.buildSummary(snapshot.root, snapshot.projectPath), bridge.activeBoard(snapshot.root, snapshot.projectPath)]);
      setBuild(summary);
      setBoard(active);
    } catch (reason) {
      appendOutput({ jobId: "project", phase: "open", stream: "stderr", message: reason instanceof Error ? reason.message : String(reason), timestamp: new Date().toISOString() });
    }
  };
  const starts = [
    { label: "Create from a verified template", run: openProjectWizard },
    { label: "Explore project source", run: () => { setActivity("explorer"); setView("editor"); } },
    { label: "Talk to the UART example", run: () => setView("uart") },
  ];
  const lessons = [
    { i: Lightbulb, t: "Your first LED design", s: "10 min", run: openProjectWizard },
    { i: Waves, t: "Read a simulation waveform", s: "12 min", run: () => setView("waveform") },
    { i: Network, t: "Understand the synthesized netlist", s: "15 min", run: () => setView("netlist") },
  ];
  const buildState = build?.status === "passed" ? "Build passed" : build?.status === "failed" ? "Build failed" : build?.status === "running" ? "Build running" : "Ready to build";
  return <section className="welcome-view">
    <header className="welcome-header"><div><p className="eyebrow">Workspace</p><h1>FPGA Studio <span>3.2</span></h1><p>{projectPath && projectPath !== "." ? projectPath : "Local FPGA workspace"}</p></div><div className="welcome-actions"><button className="primary-button" onClick={openProjectWizard}><Plus size={15}/> New project</button><button className="secondary-button" onClick={() => { setActivity("explorer"); setView("editor"); }}><FolderOpen size={15}/> Open source</button></div></header>
    <div className="welcome-workspace">
      <main className="welcome-main">
        <section className="welcome-section project-summary"><div className="welcome-section-title"><h2>Active project</h2><button className="text-button" onClick={() => setView("hardware")}>Hardware manager <ChevronRight size={13}/></button></div><div className="property-table"><div><span>Project</span><strong>{project || "No project loaded"}</strong></div><div><span>Target board</span><strong>{board?.name ?? "Loading board profile"}</strong></div><div><span>FPGA device</span><code>{board?.device ?? "—"}</code></div><div><span>Clock</span><strong>{board?.clocks[0] ? `${board.clocks[0].frequencyHz / 1_000_000} MHz` : "—"}</strong></div><div><span>Build status</span><strong className={`build-state ${build?.status ?? "ready"}`}>{buildState}</strong></div></div></section>
        <section className="welcome-section"><div className="welcome-section-title"><h2>Getting started</h2><span>Guided FPGA workflows</span></div><div className="lesson-list">{lessons.map(({i:Icon,t,s,run}) => <button className="lesson-card" key={t} onClick={run}><Icon size={16}/><span><strong>{t}</strong><small>{s} guided lesson</small></span><ArrowRight size={13}/></button>)}</div></section>
      </main>
      <aside className="welcome-side"><section className="welcome-section"><div className="welcome-section-title"><h2>Start</h2></div>{starts.map((item) => <button className="start-link" key={item.label} onClick={item.run}><ChevronRight size={13}/>{item.label}</button>)}{recentProjects.filter((path) => path !== projectPath).slice(0, 4).map((path) => <button className="start-link recent-project" key={path} onClick={() => void switchProject(path)} title={path}><FolderOpen size={13}/><span>{path.split("/").at(-1)}</span></button>)}</section><section className="welcome-section"><div className="welcome-section-title"><h2>What’s new</h2><span>v3.2.1</span></div><div className="release-card"><h3>Windows reliability hotfix</h3><p>Real native Verilator lint, bounded test workers, safer example HDL, and clearer JTAG recovery.</p><button className="text-button" onClick={() => window.dispatchEvent(new Event("fpga-studio:release-notes"))}><BookOpen size={13}/> Release notes</button></div></section></aside>
    </div>
    <footer className="welcome-tip"><Sparkles size={14}/><span><strong>Keyboard workflow</strong> — <kbd>Ctrl K</kbd> commands · <kbd>Ctrl P</kbd> files · <kbd>Ctrl T</kbd> symbols · <kbd>Ctrl Shift F</kbd> project search.</span></footer>
  </section>;
}
