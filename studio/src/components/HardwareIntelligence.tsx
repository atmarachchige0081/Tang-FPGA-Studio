import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, AlertCircle, ArrowRight, Box, Check, ChevronDown,
  ChevronRight, CircuitBoard, Clock3, Cpu, Database, FlaskConical,
  Gauge, GitCompareArrows, LocateFixed, MapPin, MemoryStick, Network, Play,
  ArrowDown, ArrowUp, Crosshair, Radio, RefreshCw, Save, Search, ShieldCheck,
  Sparkles, Target, TimerReset, Upload, Waves, Zap, ZoomIn, ZoomOut,
} from "lucide-react";
import { bridge } from "../lib/bridge";
import { useWorkbench } from "../store/workbench";
import type {
  AnalyzerCapture, AnalyzerConfig, AnalyzerSignal, AnalyzerWorkspace, BuildAction,
  DesignEvidence, DesignIntelligenceGraph, OptimizationExperiment,
  OptimizationSummary, SnapshotComparison, TimingTrace, WaveformData,
} from "../types";

type RunAction = (action: BuildAction) => Promise<boolean>;

function EvidenceBadge({ evidence }: { evidence: DesignEvidence }): React.JSX.Element {
  return <span className={`evidence-badge ${evidence.class}`} title={`${evidence.source}: ${evidence.detail}`}><span />{evidence.class}</span>;
}

function ViewState({ icon: Icon, title, detail, retry }: { icon: typeof Activity; title: string; detail: string; retry?: () => void }): React.JSX.Element {
  return <div className="view-state intelligence-state"><Icon size={28}/><strong>{title}</strong><p>{detail}</p>{retry && <button className="secondary-button" onClick={retry}><RefreshCw size={14}/> Retry</button>}</div>;
}

export function TraceabilityView(): React.JSX.Element {
  const { root, projectPath, openFile } = useWorkbench();
  const [graph, setGraph] = useState<DesignIntelligenceGraph | null>(null);
  const [selectedPathId, setSelectedPathId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!root) return;
    setLoading(true); setError(null);
    try {
      const next = await bridge.designGraph(root, projectPath);
      setGraph(next);
      setSelectedPathId((current) => next.timingPaths.some((path) => path.id === current) ? current : next.timingPaths[0]?.id ?? null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  }, [root, projectPath]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener("fpga-studio:intelligence-refresh", refresh);
    return () => window.removeEventListener("fpga-studio:intelligence-refresh", refresh);
  }, [load]);

  const selected = graph?.timingPaths.find((path) => path.id === selectedPathId) ?? null;
  const nodes = useMemo(() => {
    const value = query.trim().toLowerCase();
    return (graph?.nodes ?? []).filter((node) => !value || [node.label, node.hierarchy, node.netlistName, node.cellType, node.sourceFile].some((entry) => entry?.toLowerCase().includes(value))).slice(0, 80);
  }, [graph, query]);

  const openSource = async (file?: string, line?: number) => {
    if (!file) return;
    const path = file.startsWith("projects/") ? file : `${projectPath.replace(/\/$/, "")}/${file}`;
    try {
      const content = await bridge.readText(root, path);
      openFile({ path, name: path.split("/").at(-1) ?? path, language: path.endsWith(".sv") ? "systemverilog" : "verilog", content, savedContent: content });
      if (line) window.setTimeout(() => window.dispatchEvent(new CustomEvent("fpga-studio:goto-line", { detail: { path, line } })), 30);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };

  return <section className="feature-view traceability-view">
    <div className="feature-header compact intelligence-header"><div><p className="eyebrow">Shared design intelligence graph</p><h1>Traceability explorer</h1><p>Follow real evidence from RTL source through synthesis, placement, timing, and hardware probes.</p></div><div className="header-actions"><span className={`graph-status ${graph?.status ?? "partial"}`}><span/>{graph?.status ?? "loading"}</span><button className="secondary-button" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={14}/> Refresh evidence</button></div></div>
    {loading ? <div className="intelligence-skeleton"><span/><span/><span/></div> : error ? <ViewState icon={AlertCircle} title="Design intelligence is unavailable" detail={error} retry={() => void load()}/> : graph && <>
      <div className="intelligence-kpis">
        <article><Network size={17}/><span>Mapped nodes</span><strong>{graph.nodes.length.toLocaleString()}</strong></article>
        <article><GitCompareArrows size={17}/><span>Evidence links</span><strong>{graph.edges.length.toLocaleString()}</strong></article>
        <article><TimerReset size={17}/><span>Timing paths</span><strong>{graph.timingPaths.length}</strong></article>
        <article><LocateFixed size={17}/><span>Placed cells</span><strong>{graph.nodes.filter((node) => node.physical).length.toLocaleString()}</strong></article>
        <article><Radio size={17}/><span>Probe links</span><strong>{graph.timingPaths.reduce((sum, path) => sum + path.analyzerChannels.length, 0)}</strong></article>
      </div>
      {graph.unavailable.length > 0 && <div className="evidence-notice"><AlertCircle size={16}/><div><strong>Partial evidence</strong>{graph.unavailable.map((message) => <span key={message}>{message}</span>)}</div></div>}
      <div className="trace-layout">
        <article className="surface-card path-browser"><div className="card-heading"><div><span>MEASURED PATHS</span><strong>Implementation timing</strong></div><EvidenceBadge evidence={graph.timingPaths[0]?.evidence ?? { class: "unavailable", source: "timing", detail: "No path" }}/></div>
          <div className="path-list">{graph.timingPaths.map((path, index) => <button key={path.id} className={selectedPathId === path.id ? "active" : ""} onClick={() => setSelectedPathId(path.id)}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{path.clock}</strong><small>{path.start} → {path.end}</small></div><div><b>{path.delayNs.toFixed(3)} ns</b><em className={(path.slackNs ?? 0) >= 0 ? "positive" : "negative"}>{path.slackNs == null ? "no slack" : `${path.slackNs >= 0 ? "+" : ""}${path.slackNs.toFixed(3)} ns`}</em></div><ChevronRight size={14}/></button>)}</div>
          {!graph.timingPaths.length && <div className="compact-empty"><TimerReset size={24}/><strong>No measured timing path</strong><span>Build the design with detailed timing enabled.</span></div>}
        </article>
        <article className="surface-card trace-detail">{selected ? <TimingPathDetail path={selected} openSource={openSource}/> : <ViewState icon={TimerReset} title="No path selected" detail="A detailed nextpnr timing report is required."/>}</article>
      </div>
      <article className="surface-card mapping-table"><div className="card-heading"><div><span>CROSS-LAYER INDEX</span><strong>RTL, netlist, and physical objects</strong></div><label className="inline-search"><Search size={14}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find signal, cell, source, or BEL"/></label></div>
        <div className="mapping-head"><span>Object</span><span>Layer</span><span>Source</span><span>Netlist identity</span><span>Physical</span><span>Evidence</span></div>
        <div className="mapping-rows">{nodes.map((node) => <button key={node.id} onClick={() => void openSource(node.sourceFile, node.sourceLine)} disabled={!node.sourceFile}><span><i className={`node-kind ${node.kind}`}/><strong>{node.label}</strong><small>{node.hierarchy}</small></span><code>{node.kind}</code><span>{node.sourceFile ? <>{node.sourceFile}<small>line {node.sourceLine}</small></> : "—"}</span><span>{node.netlistName ?? node.cellType ?? "—"}</span><span>{node.physical ? <><MapPin size={11}/> X{node.physical.x} Y{node.physical.y}<small>{node.physical.bel}</small></> : "unavailable"}</span><EvidenceBadge evidence={node.evidence}/></button>)}</div>
      </article>
    </>}
  </section>;
}

function TimingPathDetail({ path, openSource }: { path: TimingTrace; openSource: (file?: string, line?: number) => Promise<void> }): React.JSX.Element {
  const total = Math.max(path.delayNs, .001);
  return <><div className="card-heading"><div><span>PATH EXPLANATION</span><strong>{path.clock}</strong></div><EvidenceBadge evidence={path.evidence}/></div>
    <div className="path-summary"><div><span>Start</span><code>{path.start}</code></div><ArrowRight size={16}/><div><span>End</span><code>{path.end}</code></div><div><span>Logic levels</span><strong>{path.logicLevels}</strong></div><div><span>Analyzer</span><strong>{path.analyzerChannels.length ? `CH ${path.analyzerChannels.join(", ")}` : "not linked"}</strong></div></div>
    <div className="segment-ribbon" aria-label="Critical path segment delay distribution">{path.segments.map((segment) => <span key={segment.index} className={segment.kind} style={{ flexGrow: Math.max(segment.delayNs / total * 100, 1) }} title={`${segment.kind}: ${segment.delayNs.toFixed(3)} ns`}/>)}</div>
    <div className="segment-legend"><span><i className="logic"/> logic</span><span><i className="routing"/> routing</span><strong>{path.delayNs.toFixed(3)} ns total</strong></div>
    <div className="segment-list">{path.segments.map((segment) => <button key={segment.index} onClick={() => void openSource(segment.sourceFile, segment.sourceLine)} disabled={!segment.sourceFile}><span>{segment.index + 1}</span><i className={segment.kind}>{segment.kind === "routing" ? <Network size={13}/> : <Box size={13}/>}</i><div><strong>{segment.net ?? segment.fromCell ?? segment.kind}</strong><small>{segment.fromCell && segment.toCell ? `${segment.fromCell} → ${segment.toCell}` : segment.sourceFile ? `${segment.sourceFile}:${segment.sourceLine}` : "Source mapping unavailable"}</small></div>{segment.physical ? <code>X{segment.physical.x}Y{segment.physical.y}</code> : <code>—</code>}<b>{segment.delayNs.toFixed(3)} ns</b></button>)}</div>
  </>;
}

export function LogicAnalyzerView({ onRun }: { onRun: RunAction }): React.JSX.Element {
  const { root, projectPath, runningJob } = useWorkbench();
  const [workspace, setWorkspace] = useState<AnalyzerWorkspace | null>(null);
  const [config, setConfig] = useState<AnalyzerConfig | null>(null);
  const [capture, setCapture] = useState<AnalyzerCapture | null>(null);
  const [ports, setPorts] = useState<string[]>([]);
  const [port, setPort] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!root) return;
    setLoading(true); setError(null);
    try {
      const [next, latest, serial] = await Promise.all([bridge.analyzerWorkspace(root, projectPath), bridge.analyzerCapture(root, projectPath), bridge.serialDevices()]);
      setWorkspace(next); setConfig(next.config); setCapture(latest);
      const names = serial.map((device) => device.portName); setPorts(names);
      setPort((current) => names.includes(current) ? current : serial.find((device) => device.likelyBoard)?.portName ?? names[0] ?? "");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  }, [root, projectPath]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const refresh = () => void load(); window.addEventListener("fpga-studio:analyzer-refresh", refresh); return () => window.removeEventListener("fpga-studio:analyzer-refresh", refresh); }, [load]);

  const filteredSignals = useMemo(() => {
    const value = query.toLowerCase().trim();
    return (workspace?.signals ?? []).filter((signal) => !value || `${signal.hierarchy} ${signal.kind} ${signal.sourceFile ?? ""}`.toLowerCase().includes(value));
  }, [workspace, query]);
  const selected = new Set(config?.channels.map((channel) => channel.signal) ?? []);
  const update = (changes: Partial<AnalyzerConfig>) => setConfig((current) => current ? { ...current, ...changes } : current);
  const toggleSignal = (signal: AnalyzerSignal) => {
    if (!config || !signal.observable) return;
    let channels = config.channels.filter((channel) => channel.signal !== signal.hierarchy);
    if (!selected.has(signal.hierarchy)) {
      if (channels.length >= 16) { setError("The analyzer supports at most 16 selected signals."); return; }
      const bits = channels.reduce((sum, channel) => sum + channel.width, 0);
      if (bits + signal.width > 128) { setError("Selected probes would exceed the 128-bit capture limit."); return; }
      channels.push({ id: channels.length, signal: signal.hierarchy, width: signal.width, radix: signal.width === 1 ? "binary" : "hex" });
    }
    channels = channels.map((channel, id) => ({ ...channel, id }));
    const validIds = new Set(channels.map((channel) => channel.id));
    let clauses = config.trigger.clauses.filter((clause) => validIds.has(clause.channelId));
    const firstChannel = channels[0];
    if (!clauses.length && firstChannel) clauses = [{ channelId: firstChannel.id, operation: firstChannel.width === 1 ? "rising" : "compare", value: "0" }];
    update({ channels, trigger: { combinator: "and", clauses } }); setError(null);
  };
  const save = async (): Promise<boolean> => {
    if (!config) return false; setBusy("save"); setError(null);
    try { const next = await bridge.saveAnalyzerConfig(root, projectPath, config); setWorkspace(next); setConfig(next.config); return true; }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return false; }
    finally { setBusy(null); }
  };
  const build = async () => { if (!await save()) return; const ok = await onRun("analyzer-build"); if (ok) { await bridge.recordSnapshot(root, projectPath, "analyzer").catch(() => undefined); await load(); } };
  const upload = async () => { const ok = await onRun("analyzer-upload"); if (ok) await load(); };
  const acquire = async () => {
    if (!port) { setError("Choose the board UART COM port before capturing."); return; }
    setBusy("capture"); setError(null);
    try { const next = await bridge.captureAnalyzer(root, projectPath, port, 15_000); setCapture(next); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(null); }
  };
  const locked = Boolean(runningJob || busy);

  return <section className="feature-view analyzer-view"><div className="feature-header compact intelligence-header"><div><p className="eyebrow">Integrated on-chip logic analyzer</p><h1>Hardware Analyzer</h1><p>Observe the implemented design with generated probes. Your RTL and persistent flash are never modified.</p></div><div className="header-actions"><EvidenceBadge evidence={{ class: capture ? "measured" : workspace?.cost.source ?? "unavailable", source: capture?.source.source ?? "Analyzer budget", detail: capture?.source.detail ?? "Cost before/after implementation" }}/><button className="secondary-button" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={14}/> Refresh</button></div></div>
    {loading ? <div className="intelligence-skeleton"><span/><span/><span/></div> : !workspace || !config ? <ViewState icon={Waves} title="Analyzer workspace unavailable" detail={error ?? "Run a baseline Build first."} retry={() => void load()}/> : <>
      {error && <div className="inline-error"><AlertCircle size={15}/><span>{error}</span><button onClick={() => setError(null)}>Dismiss</button></div>}
      {workspace.warnings.map((warning) => <div className="evidence-notice" key={warning}><AlertCircle size={15}/><span>{warning}</span></div>)}
      <div className="analyzer-topline"><article><Target size={17}/><span>Signals</span><strong>{config.channels.length}/16</strong><small>{config.channels.reduce((sum, channel) => sum + channel.width, 0)}/128 bits</small></article><article><MemoryStick size={17}/><span>Capture depth</span><strong>{config.sampleDepth.toLocaleString()}</strong><small>{config.preTriggerSamples} pre-trigger</small></article><article><Cpu size={17}/><span>Estimated LUT</span><strong>{workspace.cost.lut >= 0 ? `+${workspace.cost.lut}` : workspace.cost.lut}</strong><small>{workspace.cost.source}</small></article><article><Database size={17}/><span>Block RAM</span><strong>{workspace.cost.bram >= 0 ? `+${workspace.cost.bram}` : workspace.cost.bram}</strong><small>{workspace.cost.source}</small></article><article><Gauge size={17}/><span>Fmax impact</span><strong>{workspace.cost.fmaxImpactPercent == null ? "pending" : `${workspace.cost.fmaxImpactPercent.toFixed(1)}%`}</strong><small>{workspace.cost.instrumentedFmaxMHz ? `${workspace.cost.instrumentedFmaxMHz.toFixed(1)} MHz` : "build to measure"}</small></article></div>
      <div className="analyzer-layout">
        <article className="surface-card signal-picker"><div className="card-heading"><div><span>PROBE CONFIGURATION</span><strong>Observable hierarchy</strong></div><span className="selection-count">{config.channels.length} selected</span></div><label className="inline-search"><Search size={14}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find register, wire, port, or hierarchy"/></label><div className="signal-list">{filteredSignals.slice(0, 400).map((signal) => <button key={signal.id} className={selected.has(signal.hierarchy) ? "selected" : ""} onClick={() => toggleSignal(signal)} disabled={!signal.observable} title={signal.unavailableReason}><span className="signal-check">{selected.has(signal.hierarchy) ? <Check size={12}/> : signal.observable ? <span/> : <AlertCircle size={11}/>}</span><div><strong>{signal.name}</strong><small>{signal.hierarchy}</small></div><code>{signal.width}b</code><em>{signal.kind}</em></button>)}</div></article>
        <div className="analyzer-config-stack">
          <article className="surface-card capture-config"><div className="card-heading"><div><span>CAPTURE WINDOW</span><strong>Clock, memory, transport</strong></div><Clock3 size={17}/></div><div className="config-grid"><label>Clock port<input value={config.clockSignal} onChange={(event) => update({ clockSignal: event.target.value })}/></label><label>Clock frequency<input type="number" value={config.clockHz} onChange={(event) => update({ clockHz: Number(event.target.value) })}/><span>Hz</span></label><label>Sample depth<select value={config.sampleDepth} onChange={(event) => { const sampleDepth = Number(event.target.value); update({ sampleDepth, preTriggerSamples: Math.min(config.preTriggerSamples, sampleDepth - 1) }); }}>{[64,128,256,512,1024,2048,4096].map((value) => <option key={value}>{value}</option>)}</select></label><label>Pre-trigger<input type="number" min={1} max={config.sampleDepth - 1} value={config.preTriggerSamples} onChange={(event) => update({ preTriggerSamples: Number(event.target.value) })}/></label><label>Analyzer RX<input value={config.transportRx} onChange={(event) => update({ transportRx: event.target.value })}/></label><label>Analyzer TX<input value={config.transportTx} onChange={(event) => update({ transportTx: event.target.value })}/></label><label>Baud rate<select value={config.baudRate} onChange={(event) => update({ baudRate: Number(event.target.value) })}>{[115200,230400,460800,921600].map((value) => <option key={value}>{value.toLocaleString()}</option>)}</select></label><label>Host COM<select value={port} onChange={(event) => setPort(event.target.value)}><option value="">Choose COM port</option>{ports.map((name) => <option key={name}>{name}</option>)}</select></label></div><div className="transport-note"><Radio size={14}/><span>The analyzer temporarily owns <code>{config.transportTx}</code> in the SRAM image; the original UART TX is restored after power-off or a normal upload.</span></div></article>
          <article className="surface-card trigger-card"><div className="card-heading"><div><span>TRIGGER ENGINE</span><strong>All clauses must match</strong></div><Target size={17}/></div>{config.trigger.clauses.map((clause, index) => { const channel = config.channels.find((item) => item.id === clause.channelId); return <div className="trigger-row" key={`${index}:${clause.channelId}`}><span>{index ? "AND" : "WHEN"}</span><select value={clause.channelId} onChange={(event) => { const clauses = [...config.trigger.clauses]; clauses[index] = { ...clause, channelId: Number(event.target.value) }; update({ trigger: { combinator: "and", clauses } }); }}>{config.channels.map((item) => <option value={item.id} key={item.id}>{item.signal}</option>)}</select><select value={clause.operation} onChange={(event) => { const clauses = [...config.trigger.clauses]; clauses[index] = { ...clause, operation: event.target.value as typeof clause.operation }; update({ trigger: { combinator: "and", clauses } }); }}><option value="compare">equals</option><option value="level">level</option>{channel?.width === 1 && <><option value="rising">rising edge</option><option value="falling">falling edge</option></>}</select><input value={clause.value} disabled={clause.operation === "rising" || clause.operation === "falling"} onChange={(event) => { const clauses = [...config.trigger.clauses]; clauses[index] = { ...clause, value: event.target.value }; update({ trigger: { combinator: "and", clauses } }); }}/></div>; })}<button className="text-button" disabled={!config.channels.length || config.trigger.clauses.length >= config.channels.length} onClick={() => { const used = new Set(config.trigger.clauses.map((clause) => clause.channelId)); const channel = config.channels.find((item) => !used.has(item.id)); if (channel) update({ trigger: { combinator: "and", clauses: [...config.trigger.clauses, { channelId: channel.id, operation: channel.width === 1 ? "rising" : "compare", value: "0" }] } }); }}><Zap size={13}/> Add AND condition</button></article>
        </div>
      </div>
      <div className="analyzer-actions"><div><ShieldCheck size={17}/><span><strong>Safe flow</strong> Save probes → build separate image → SRAM upload → capture over UART</span></div><button className="secondary-button" onClick={() => void save()} disabled={locked || !config.channels.length}><Save size={14}/> {busy === "save" ? "Saving…" : "Save probes"}</button><button className="secondary-button" onClick={() => void build()} disabled={locked || !config.channels.length}><CircuitBoard size={14}/> Build analyzer</button><button className="secondary-button" onClick={() => void upload()} disabled={locked || !workspace.generated}><Upload size={14}/> Upload SRAM</button><button className="primary-button" onClick={() => void acquire()} disabled={locked || !port}><Play size={14}/> {busy === "capture" ? "Waiting for trigger…" : "Arm & capture"}</button></div>
      <article className="surface-card analyzer-waveform"><div className="card-heading"><div><span>HARDWARE CAPTURE</span><strong>{capture ? `${capture.waveform.signals.length} channels · trigger at sample ${capture.triggerIndex}` : "No measured capture yet"}</strong></div>{capture && <EvidenceBadge evidence={capture.source}/>}</div>{capture ? <CaptureWaveform waveform={capture.waveform} triggerIndex={capture.triggerIndex}/> : <div className="capture-empty"><Waves size={30}/><strong>Ready for physical FPGA evidence</strong><span>Upload the generated SRAM image, choose the board UART, then arm the trigger.</span></div>}</article>
    </>}
  </section>;
}

type CaptureRadix = "binary" | "hex" | "decimal";

export function CaptureWaveform({ waveform, triggerIndex }: { waveform: WaveformData; triggerIndex: number }): React.JSX.Element {
  const width = 1000;
  const rowHeight = 42;
  const end = Math.max(waveform.endTime, 1);
  const [zoom, setZoom] = useState(1);
  const [cursor, setCursor] = useState(Math.min(triggerIndex, end));
  const [order, setOrder] = useState(() => waveform.signals.map((signal) => signal.id));
  const [radix, setRadix] = useState<Record<string, CaptureRadix>>({});

  useEffect(() => {
    const ids = waveform.signals.map((signal) => signal.id);
    setOrder((current) => [...current.filter((id) => ids.includes(id)), ...ids.filter((id) => !current.includes(id))]);
    setCursor((current) => Math.min(current, end));
  }, [waveform, end]);

  const signals = order
    .map((id) => waveform.signals.find((signal) => signal.id === id))
    .filter((signal): signal is WaveformData["signals"][number] => Boolean(signal));
  const valueAt = (signal: WaveformData["signals"][number]): string => {
    let value = signal.samples[0]?.value ?? "0";
    for (const sample of signal.samples) { if (sample.time > cursor) break; value = sample.value; }
    const base = radix[signal.id] ?? (signal.width === 1 ? "binary" : "hex");
    if (!/^[01]+$/.test(value)) return value;
    if (base === "binary") return `0b${value}`;
    const numeric = BigInt(`0b${value}`);
    return base === "decimal" ? numeric.toString(10) : `0x${numeric.toString(16).toUpperCase()}`;
  };
  const move = (id: string, direction: -1 | 1) => setOrder((current) => {
    const index = current.indexOf(id);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= current.length) return current;
    const next = [...current];
    const sourceId = next[index];
    const destinationId = next[destination];
    if (sourceId == null || destinationId == null) return current;
    next[index] = destinationId;
    next[destination] = sourceId;
    return next;
  });
  const selectSample = (event: React.MouseEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    setCursor(Math.max(0, Math.min(end, Math.round((event.clientX - bounds.left) / Math.max(bounds.width, 1) * end))));
  };
  const triggerX = triggerIndex / end * width;
  const cursorX = cursor / end * width;

  return <div className="capture-wave-shell">
    <div className="capture-wave-toolbar"><div><Crosshair size={13}/><strong>Sample {cursor}</strong><span>Δ trigger {cursor - triggerIndex >= 0 ? "+" : ""}{cursor - triggerIndex}</span><span>{waveform.timescale}</span></div><div><button onClick={() => setZoom((value) => Math.max(1, value / 2))} disabled={zoom <= 1} title="Zoom out"><ZoomOut size={14}/></button><code>{zoom}×</code><button onClick={() => setZoom((value) => Math.min(8, value * 2))} disabled={zoom >= 8} title="Zoom in"><ZoomIn size={14}/></button></div></div>
    <div className="capture-wave-scroll"><div className="capture-wave-body" style={{ width: `${zoom * 100}%` }}><div className="capture-ruler"><span>0</span><span>{Math.round(end / 2)}</span><span>{end} samples</span></div>{signals.map((signal, row) => { const points: string[] = []; signal.samples.forEach((sample, index) => { const x = sample.time / end * width; const y = sample.value.endsWith("1") ? 10 : 30; const previous = signal.samples[index - 1]; if (previous) points.push(`${x},${previous.value.endsWith("1") ? 10 : 30}`); points.push(`${x},${y}`); }); const selectedRadix = radix[signal.id] ?? (signal.width === 1 ? "binary" : "hex"); return <div className="capture-row" key={`${signal.scope}:${signal.id}`}><div className="capture-signal-label"><i/><strong>{signal.name}</strong><small>{signal.scope}</small><span><button onClick={() => move(signal.id, -1)} disabled={row === 0} title="Move signal up"><ArrowUp size={10}/></button><button onClick={() => move(signal.id, 1)} disabled={row === signals.length - 1} title="Move signal down"><ArrowDown size={10}/></button></span></div><svg viewBox={`0 0 ${width} ${rowHeight}`} preserveAspectRatio="none" onClick={selectSample} aria-label={`${signal.name} waveform`}><line className="trigger-line" x1={triggerX} x2={triggerX} y1="0" y2={rowHeight}/><line className="cursor-line" x1={cursorX} x2={cursorX} y1="0" y2={rowHeight}/><polyline points={points.join(" ")}/></svg><select aria-label={`${signal.name} radix`} value={selectedRadix} onChange={(event) => setRadix((current) => ({ ...current, [signal.id]: event.target.value as CaptureRadix }))}><option value="binary">bin</option><option value="hex">hex</option><option value="decimal">dec</option></select><code>{valueAt(signal)}</code></div>; })}</div></div>
    <div className="capture-pan-hint">Scroll horizontally to pan · click a waveform to place the measurement cursor</div>
  </div>;
}

export function DesignHealthView({ onRun }: { onRun: RunAction }): React.JSX.Element {
  const { root, projectPath, runningJob } = useWorkbench();
  const [summary, setSummary] = useState<OptimizationSummary | null>(null);
  const [comparison, setComparison] = useState<SnapshotComparison | null>(null);
  const [baselineId, setBaselineId] = useState<number | null>(null);
  const [candidateId, setCandidateId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!root) return; setBusy("load"); setError(null);
    try { const next = await bridge.optimizationSummary(root, projectPath); setSummary(next); const ids = next.snapshots.map((snapshot) => snapshot.id); setBaselineId((current) => current && ids.includes(current) ? current : ids.at(-2) ?? ids[0] ?? null); setCandidateId((current) => current && ids.includes(current) ? current : ids.at(-1) ?? null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(null); }
  }, [root, projectPath]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const refresh = () => void load(); window.addEventListener("fpga-studio:health-refresh", refresh); return () => window.removeEventListener("fpga-studio:health-refresh", refresh); }, [load]);
  const runExperiment = async (recommendationId: string) => {
    setBusy(recommendationId); setError(null);
    let experiment: OptimizationExperiment | null = null;
    try { experiment = await bridge.prepareExperiment(root, projectPath, recommendationId); const success = await onRun("experiment"); await bridge.finishExperiment(root, projectPath, experiment.id, success); await load(); }
    catch (reason) { if (experiment) await bridge.finishExperiment(root, projectPath, experiment.id, false).catch(() => undefined); setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(null); }
  };
  const compare = async () => { if (baselineId == null || candidateId == null || baselineId === candidateId) return; setBusy("compare"); try { setComparison(await bridge.compareSnapshots(root, projectPath, baselineId, candidateId)); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(null); } };
  const statusIcon = (status: string) => status === "healthy" ? ShieldCheck : status === "critical" ? AlertCircle : status === "attention" ? Target : Database;

  return <section className="feature-view health-view"><div className="feature-header compact intelligence-header"><div><p className="eyebrow">Evidence-driven optimization</p><h1>Design Health</h1><p>Recommendations explain why they apply, run as isolated experiments, and compare measured reports.</p></div><div className="header-actions"><button className="secondary-button" onClick={() => void load()} disabled={busy === "load"}><RefreshCw className={busy === "load" ? "spin" : ""} size={14}/> Recompute health</button></div></div>
    {error && <div className="inline-error"><AlertCircle size={15}/><span>{error}</span><button onClick={() => setError(null)}>Dismiss</button></div>}
    {!summary ? <div className="intelligence-skeleton"><span/><span/><span/></div> : <>
      <div className="health-grid">{summary.health.map((item) => { const Icon = statusIcon(item.status); const evidence = item.evidence[0] ?? { class: "unavailable" as const, source: "No evidence", detail: "Evidence was not provided." }; return <article key={item.id} className={item.status}><div><Icon size={18}/><span>{item.label}</span><EvidenceBadge evidence={evidence}/></div><strong>{item.status}</strong><p>{item.detail}</p></article>; })}</div>
      <div className="health-layout"><article className="surface-card recommendation-panel"><div className="card-heading"><div><span>ACTIONABLE RECOMMENDATIONS</span><strong>Evidence before advice</strong></div><Sparkles size={17}/></div><div className="recommendation-list">{summary.recommendations.map((item) => <div className={`recommendation ${item.applicable ? "applicable" : "not-applicable"}`} key={item.id}><button className="recommendation-main" onClick={() => setExpanded(expanded === item.id ? null : item.id)}><span className="recommendation-icon">{item.category === "timing" ? <Clock3 size={17}/> : item.category === "routing" ? <Network size={17}/> : <MemoryStick size={17}/>}</span><div><span>{item.category}</span><strong>{item.title}</strong><p>{item.summary}</p></div><em>{item.applicable ? "applies" : "not indicated"}</em>{expanded === item.id ? <ChevronDown size={15}/> : <ChevronRight size={15}/>}</button>{expanded === item.id && <div className="recommendation-detail"><div><strong>Why this recommendation</strong>{item.evidence.map((evidence, index) => <p key={index}><EvidenceBadge evidence={evidence}/><span>{evidence.detail}</span><code>{evidence.source}</code></p>)}</div><div><strong>Expected impact</strong><p>{item.expectedImpact}</p></div>{item.experimentKind !== "none" && <button className="primary-button" disabled={!item.applicable || Boolean(runningJob || busy)} onClick={() => void runExperiment(item.id)}><FlaskConical size={14}/>{busy === item.id ? "Running measured experiment…" : "Run isolated experiment"}</button>}</div>}</div>)}</div>{!summary.recommendations.length && <div className="compact-empty"><Sparkles size={24}/><strong>No evidence-backed action yet</strong><span>Build the design to populate timing and resource evidence.</span></div>}</article>
        <article className="surface-card regression-panel"><div className="card-heading"><div><span>REGRESSION MONITOR</span><strong>{summary.regressions.length ? `${summary.regressions.length} measured change(s)` : "No measured regression"}</strong></div><GitCompareArrows size={17}/></div>{summary.regressions.map((item) => <div className="regression-row" key={item.id}><AlertCircle size={15}/><div><strong>{item.title}</strong><span>{item.detail}</span></div></div>)}{!summary.regressions.length && <div className="regression-clean"><ShieldCheck size={28}/><strong>No threshold crossings</strong><span>Fmax, slack, and resource deltas remain within monitored limits.</span></div>}<div className="experiment-history"><span>EXPERIMENT HISTORY</span>{summary.experiments.slice().reverse().slice(0, 6).map((experiment) => <div key={experiment.id}><FlaskConical size={13}/><span><strong>{experiment.title}</strong><small>{experiment.options.join(" · ")}</small></span><em className={experiment.status}>{experiment.status}</em></div>)}</div></article></div>
      <article className="surface-card snapshot-panel"><div className="card-heading"><div><span>DESIGN SNAPSHOTS</span><strong>Compare implementation truth</strong></div><div className="snapshot-controls"><select value={baselineId ?? ""} onChange={(event) => setBaselineId(Number(event.target.value))}><option value="">Baseline</option>{summary.snapshots.map((snapshot) => <option key={snapshot.id} value={snapshot.id}>#{snapshot.id} {snapshot.kind} · {snapshot.fmaxMHz?.toFixed(1) ?? "—"} MHz</option>)}</select><ArrowRight size={14}/><select value={candidateId ?? ""} onChange={(event) => setCandidateId(Number(event.target.value))}><option value="">Candidate</option>{summary.snapshots.map((snapshot) => <option key={snapshot.id} value={snapshot.id}>#{snapshot.id} {snapshot.kind} · {snapshot.fmaxMHz?.toFixed(1) ?? "—"} MHz</option>)}</select><button className="secondary-button" onClick={() => void compare()} disabled={baselineId == null || candidateId == null || baselineId === candidateId || busy === "compare"}><GitCompareArrows size={14}/> Compare</button></div></div>{comparison ? <div className="comparison-table"><div><span>Metric</span><span>Baseline</span><span>Candidate</span><span>Delta</span></div>{comparison.metrics.map((metric) => <div key={metric.metric}><strong>{metric.metric}</strong><span>{metric.baseline?.toFixed(2) ?? "—"} {metric.unit}</span><span>{metric.candidate?.toFixed(2) ?? "—"} {metric.unit}</span><span className={(metric.delta ?? 0) < 0 && metric.metric === "Fmax" ? "negative" : ""}>{metric.delta == null ? "—" : `${metric.delta >= 0 ? "+" : ""}${metric.delta.toFixed(2)}`} {metric.percent == null ? "" : `(${metric.percent.toFixed(1)}%)`}</span></div>)}</div> : <div className="snapshot-timeline">{summary.snapshots.slice().reverse().slice(0, 10).map((snapshot) => <div key={snapshot.id}><span>#{snapshot.id}</span><i/><div><strong>{snapshot.kind}</strong><small>{new Date(snapshot.createdAt).toLocaleString()} · {snapshot.gitCommit?.slice(0, 8) ?? "working tree"}</small></div><b>{snapshot.fmaxMHz?.toFixed(2) ?? "—"} MHz</b><em className={snapshot.verificationStatus}>{snapshot.verificationStatus}</em></div>)}{!summary.snapshots.length && <div className="compact-empty"><Database size={24}/><strong>No design snapshot yet</strong><span>Successful Build and Analyzer Build actions create measured snapshots.</span></div>}</div>}</article>
    </>}
  </section>;
}
