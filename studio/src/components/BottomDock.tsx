import { useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, CircleAlert, CircleX, Copy, Eraser, Info, Search, TerminalSquare } from "lucide-react";
import { openWorkspaceLocation } from "../lib/navigation";
import { useWorkbench } from "../store/workbench";
import type { BottomPanel } from "../types";

const panels: Array<{ id: BottomPanel; label: string }> = [
  { id: "problems", label: "Problems" }, { id: "output", label: "Output" }, { id: "terminal", label: "Terminal" }, { id: "waveform", label: "Waveform log" },
];

export function BottomDock(): React.JSX.Element {
  const { bottomPanel, bottomOpen, setBottomPanel, toggleBottom, diagnostics, clearOutput, output } = useWorkbench();
  const copyOutput = () => void navigator.clipboard.writeText(output.map((event) => `[${event.phase}] ${event.message}`).join("\n")).catch(() => undefined);
  return <section className={`bottom-dock ${bottomOpen ? "open" : "closed"}`}>
    <div className="dock-tabs">
      {panels.map((panel) => <button className={panel.id === bottomPanel ? "active" : ""} key={panel.id} onClick={() => setBottomPanel(panel.id)}>{panel.label}{panel.id === "problems" && diagnostics.length > 0 && <span className="count-badge">{diagnostics.length}</span>}</button>)}
      <span className="dock-spacer" />
      <button className="dock-icon" onClick={clearOutput} title="Clear output"><Eraser size={14}/></button>
      <button className="dock-icon" title="Copy output" onClick={copyOutput} disabled={!output.length}><Copy size={14}/></button>
      <button className="dock-icon" onClick={toggleBottom} title={bottomOpen ? "Collapse panel" : "Expand panel"}>{bottomOpen ? <ChevronDown size={15}/> : <ChevronUp size={15}/>}</button>
    </div>
    {bottomOpen && <div className="dock-content">
      {bottomPanel === "problems" ? <Problems/> : bottomPanel === "terminal" ? <Terminal/> : <Output/>}
    </div>}
  </section>;
}

function Problems(): React.JSX.Element {
  const { diagnostics, appendOutput } = useWorkbench();
  const [filter, setFilter] = useState<"all" | "error" | "warning" | "info">("all");
  const [query, setQuery] = useState("");
  if (!diagnostics.length) return <div className="empty-dock"><CheckCircle2 size={18}/><span>No problems detected in the active project.</span></div>;
  const normalized = query.trim().toLowerCase();
  const visible = diagnostics
    .filter((item) => (filter === "all" || item.severity === filter) && (!normalized || `${item.message} ${item.file ?? ""} ${item.code ?? ""}`.toLowerCase().includes(normalized)))
    .sort((left, right) => `${left.file ?? ""}:${left.line ?? 0}`.localeCompare(`${right.file ?? ""}:${right.line ?? 0}`));
  const groups = (["error", "warning", "info"] as const).map((severity) => ({ severity, items: visible.filter((item) => item.severity === severity) })).filter((group) => group.items.length);
  const open = (file: string | undefined, line?: number, column?: number) => {
    if (!file) return;
    void openWorkspaceLocation(file, line, column).catch((reason: unknown) => appendOutput({ jobId: "problems", phase: "open", stream: "stderr", message: reason instanceof Error ? reason.message : String(reason), timestamp: new Date().toISOString() }));
  };
  return <div className="problems-view"><div className="problems-toolbar"><div>{(["all", "error", "warning", "info"] as const).map((severity) => <button className={filter === severity ? "active" : ""} key={severity} onClick={() => setFilter(severity)}>{severity === "all" ? "All" : `${severity[0]?.toUpperCase()}${severity.slice(1)}`}<span>{severity === "all" ? diagnostics.length : diagnostics.filter((item) => item.severity === severity).length}</span></button>)}</div><label><Search size={12}/><input aria-label="Filter Problems" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter problems"/></label></div><div className="problem-list">{groups.map((group) => <section key={group.severity}><header>{group.severity === "error" ? <CircleX size={12}/> : group.severity === "warning" ? <CircleAlert size={12}/> : <Info size={12}/>}<strong>{group.severity.toUpperCase()}</strong><span>{group.items.length}</span></header>{group.items.map((item, index) => <button className={`problem-row ${item.severity}`} title={item.suggestion} key={`${item.message}-${index}`} onClick={() => open(item.file, item.line, item.column)} disabled={!item.file}>{item.severity === "error" ? <CircleX size={14}/> : item.severity === "warning" ? <CircleAlert size={14}/> : <Info size={14}/>}<span>{item.message}</span><code>{item.file}{item.line ? `:${item.line}${item.column ? `:${item.column}` : ""}` : ""}</code><small>{item.code ?? item.source}</small></button>)}</section>)}</div></div>;
}

function Output(): React.JSX.Element {
  const output = useWorkbench((state) => state.output);
  const [technical, setTechnical] = useState(false);
  if (!output.length) return <div className="empty-dock"><TerminalSquare size={18}/><span>Build and tool output will appear here.</span></div>;
  const isTechnical = (message: string) => /^\s*(?:At .+:\d+ char:\d+|\+|~+|CategoryInfo|FullyQualifiedErrorId|warnings\.warn\()/.test(message) || /apycula[/\\].*UserWarning: .*performance will be degraded/i.test(message) || !message.trim();
  const hidden = output.filter((event) => isTechnical(event.message)).length;
  const allVisible = technical ? output : output.filter((event) => !isTechnical(event.message));
  const omitted = Math.max(0, allVisible.length - 400);
  const visible = allVisible.slice(-400);
  return <div className="output-view"><div className="output-options"><span>{technical ? "Complete tool output" : "Beginner-friendly output"}{omitted > 0 ? ` · ${omitted} older lines kept off-screen for performance` : ""}</span>{hidden > 0 && <button onClick={() => setTechnical((value) => !value)}>{technical ? "Hide technical details" : `Show ${hidden} technical detail${hidden === 1 ? "" : "s"}`}</button>}</div><div className="output-lines" aria-live="polite">{visible.map((event, index) => <div className={event.stream} key={`${event.timestamp}-${index}`}><span>{new Date(event.timestamp).toLocaleTimeString([], { hour12: false })}</span><strong>{event.phase}</strong><code>{event.message}</code></div>)}</div></div>;
}

function Terminal(): React.JSX.Element {
  return <div className="mini-terminal"><div><span className="prompt">PS</span> FPGA_DEV_ENV&gt; <span className="command">.\fpga.ps1 doctor</span></div><div className="terminal-ok"><CheckCircle2 size={13}/> Toolchain ready · Tang Primer 20K profile loaded</div><div><span className="prompt">PS</span> FPGA_DEV_ENV&gt; <span className="terminal-caret">▌</span></div></div>;
}
