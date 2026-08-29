import { BarChart3, Bug, CircuitBoard, Cpu, ListChecks, LoaderCircle, Network, Play, Radio, Rocket, Save, ScanSearch, Square, Upload, Waves } from "lucide-react";
import type { BuildAction, WorkbenchView } from "../types";
import { useWorkbench } from "../store/workbench";

interface Props { onRun: (action: BuildAction) => void; onSave: () => void; onStop: () => void }

export function CommandBar({ onRun, onSave, onStop }: Props): React.JSX.Element {
  const { runningJob, setView, board } = useWorkbench();
  const nav = (view: WorkbenchView, title: string, Icon: typeof BarChart3) => <button className="tool-button view-button" onClick={() => setView(view)} title={title} aria-label={`Open ${title}`}><Icon size={15} /><span>{title}</span></button>;
  return (
    <div className="commandbar">
      <div className="command-group">
        <button className="tool-button" onClick={onSave} title="Save active file"><Save size={16} /><span>Save</span></button>
        <span className="tool-separator" />
        <button className="tool-button" onClick={() => onRun("lint")} disabled={Boolean(runningJob)}><Bug size={16} /><span>Lint</span></button>
        <button className="tool-button" onClick={() => onRun("sim")} disabled={Boolean(runningJob)}><Play size={16} /><span>Simulate</span></button>
        <button className="primary-tool" onClick={() => onRun("build")} disabled={Boolean(runningJob)}>{runningJob ? <LoaderCircle className="spin" size={16} /> : <Rocket size={16} />}<span>{runningJob ? "Building…" : "Build"}</span></button>
        <button className="tool-button" onClick={() => onRun("upload")} disabled={Boolean(runningJob)} title="Load volatile SRAM"><Upload size={16} /><span>SRAM</span></button>
        {runningJob && <button className="stop-tool" onClick={onStop}><Square size={14} /> Stop</button>}
      </div>
      <div className="command-group view-tools" aria-label="Workspace views">
        {nav("analysis", "Analyze", ScanSearch)}
        {nav("verification", "Verify", ListChecks)}
        {nav("health", "Health", BarChart3)}
        {nav("traceability", "Trace", Network)}
        {nav("analyzer", "Analyzer", Waves)}
        {nav("dashboard", "Insights", BarChart3)}
        {nav("waveform", "Waveform", Waves)}
        {nav("netlist", "Netlist", Network)}
        {nav("hardware", "Hardware", CircuitBoard)}
        {nav("uart", "UART", Radio)}
      </div>
      <div className="target-pill" title="Active target"><Cpu size={14} /><span>{board?.name.replace("Sipeed ", "") ?? "Loading board"}</span><span className="online-dot" /><span>{board?.clocks[0] ? `${board.clocks[0].frequencyHz / 1_000_000} MHz` : "--"}</span></div>
    </div>
  );
}
