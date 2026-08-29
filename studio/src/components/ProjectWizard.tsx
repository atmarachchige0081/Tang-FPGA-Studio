import { useEffect, useMemo, useState } from "react";
import { Check, CircuitBoard, Cpu, FolderPlus, LoaderCircle, ShieldCheck, SlidersHorizontal, X } from "lucide-react";
import { bridge } from "../lib/bridge";
import { fpgaTargetFromBoard } from "../lib/hdl-intelligence";
import { useWorkbench } from "../store/workbench";
import type { BoardProfile, ProjectTemplate } from "../types";

const validProjectName = /^\d{2}_[a-z][a-z0-9_]*$/;
const validIdentifier = /^[A-Za-z_]\w*$/;
type ProjectMode = "template" | "custom";

const packagedPath = (path: string | undefined, fallback: string): string => {
  const name = path?.replaceAll("\\", "/").split("/").at(-1);
  return `constraints/${name || fallback}`;
};

export function ProjectWizard(): React.JSX.Element | null {
  const { projectWizardOpen, closeProjectWizard, root, setWorkspace, setBuild, setBoard } = useWorkbench();
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [boards, setBoards] = useState<BoardProfile[]>([]);
  const [mode, setMode] = useState<ProjectMode>(() => import.meta.env.DEV && new URLSearchParams(window.location.search).get("capture") === "custom-project" ? "custom" : "template");
  const [templateId, setTemplateId] = useState("serial_commands");
  const [boardId, setBoardId] = useState("tang_primer_20k");
  const [targetDevice, setTargetDevice] = useState("GW2A-LV18PG256C8/I7");
  const [folderName, setFolderName] = useState("06_my_fpga_project");
  const [displayName, setDisplayName] = useState("My FPGA project");
  const [top, setTop] = useState("top");
  const [clockMhz, setClockMhz] = useState("27");
  const [constraintPath, setConstraintPath] = useState("constraints/primer20k_dock.cst");
  const [timingPath, setTimingPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!projectWizardOpen || !root) return;
    let disposed = false;
    setError("");
    void Promise.all([bridge.projectTemplates(root), bridge.boards(root)]).then(([templateItems, boardItems]) => {
      if (disposed) return;
      setTemplates(templateItems);
      setBoards(boardItems);
      if (templateItems[0] && !templateItems.some((item) => item.id === templateId)) setTemplateId(templateItems[0].id);
      if (boardItems[0] && !boardItems.some((item) => item.device === targetDevice)) setTargetDevice(boardItems[0].device);
    }).catch((reason: unknown) => { if (!disposed) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { disposed = true; };
  }, [projectWizardOpen, root]);

  const selectedTemplate = useMemo(() => templates.find((item) => item.id === templateId), [templates, templateId]);
  const targets = useMemo(() => boards.filter((board, index) => boards.findIndex((candidate) => candidate.device === board.device) === index), [boards]);
  const compatibleBoards = useMemo(() => {
    if (mode === "custom") return boards.filter((board) => board.device === targetDevice);
    const supported = selectedTemplate?.supportedBoards?.length ? selectedTemplate.supportedBoards : ["tang_primer_20k"];
    return boards.filter((board) => supported.includes(board.id));
  }, [boards, mode, selectedTemplate, targetDevice]);
  const selectedBoard = compatibleBoards.find((board) => board.id === boardId) ?? compatibleBoards[0];
  const selectedTarget = selectedBoard ? fpgaTargetFromBoard(selectedBoard) : null;
  const nameValid = validProjectName.test(folderName);
  const customValid = Boolean(selectedBoard && selectedTarget && validIdentifier.test(top) && Number(clockMhz) >= 0.1 && Number(clockMhz) <= 1000 && /^constraints\/(?!.*\.\.)[^/].*\.cst$/i.test(constraintPath) && (!timingPath || /^constraints\/(?!.*\.\.)[^/].*\.sdc$/i.test(timingPath)));

  useEffect(() => {
    if (compatibleBoards[0] && !compatibleBoards.some((board) => board.id === boardId)) setBoardId(compatibleBoards[0].id);
  }, [compatibleBoards, boardId]);

  useEffect(() => {
    if (!selectedBoard || mode !== "custom") return;
    setClockMhz(String((selectedBoard.clocks[0]?.frequencyHz ?? 27_000_000) / 1_000_000));
    setConstraintPath(packagedPath(selectedBoard.constraints[0], `${selectedBoard.id}.cst`));
    setTimingPath(selectedBoard.timingConstraints?.[0] ? packagedPath(selectedBoard.timingConstraints[0], `${selectedBoard.id}.sdc`) : "");
  }, [selectedBoard?.id, mode]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!nameValid || !selectedBoard || loading || (mode === "template" ? !selectedTemplate : !customValid || !selectedTarget)) return;
    setLoading(true);
    setError("");
    try {
      const snapshot = mode === "template"
        ? await bridge.createProject(root, folderName, templateId, displayName, selectedBoard.id)
        : await bridge.createCustomProject(root, folderName, {
          displayName: displayName.trim() || folderName,
          boardId: selectedBoard.id,
          target: selectedTarget!,
          top,
          clockSignal: selectedBoard.clocks[0]?.name ?? "clk",
          clockMhz: Number(clockMhz),
          constraintPath,
          timingConstraintPath: timingPath || undefined,
          toolchain: selectedBoard.build?.backend ?? "oss-cad-suite",
          programmer: selectedBoard.programmer.board,
          sourceRoots: ["rtl"],
          testRoots: ["sim"],
        });
      setWorkspace(snapshot.root, snapshot.project, snapshot.projectPath, snapshot.tree, snapshot.recentProjects);
      const [summary, board] = await Promise.all([
        bridge.buildSummary(snapshot.root, snapshot.projectPath),
        bridge.activeBoard(snapshot.root, snapshot.projectPath),
      ]);
      setBuild(summary);
      setBoard(board);
      closeProjectWizard();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  if (!projectWizardOpen) return null;
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !loading) closeProjectWizard(); }}>
    <section className="project-wizard" role="dialog" aria-modal="true" aria-labelledby="wizard-title">
      <header><div><h1 id="wizard-title">New FPGA project</h1><p>Start from a preset or configure a supported FPGA target directly.</p></div><button className="icon-button" onClick={closeProjectWizard} disabled={loading} aria-label="Close project wizard"><X size={17}/></button></header>
      <form onSubmit={(event) => void create(event)}>
        <div className="wizard-mode" role="tablist" aria-label="Project mode"><button type="button" role="tab" aria-selected={mode === "template"} className={mode === "template" ? "selected" : ""} onClick={() => setMode("template")}><FolderPlus size={14}/> Template project<span>Verified presets</span></button><button type="button" role="tab" aria-selected={mode === "custom"} className={mode === "custom" ? "selected" : ""} onClick={() => setMode("custom")}><SlidersHorizontal size={14}/> Custom project<span>Explicit target configuration</span></button></div>
        <div className="wizard-layout">
          <section className="wizard-pane template-pane">
            <div className="wizard-pane-title"><strong>{mode === "template" ? "Template preset" : "FPGA target"}</strong><small>{mode === "template" ? "Synthesizable RTL with a self-checking simulation" : "Silicon is separate from the physical board package"}</small></div>
            <div className="template-grid">{mode === "template" ? templates.map((template) => <button type="button" className={`template-card ${template.id === templateId ? "selected" : ""}`} key={template.id} onClick={() => setTemplateId(template.id)}><span className="template-check">{template.id === templateId && <Check size={11}/>}</span><span className="template-category">{template.category}</span><strong>{template.name}</strong><p>{template.description}</p><span className="template-meta">{template.level} · {template.hardwareReady ? "hardware ready" : "simulation first"}</span></button>) : targets.map((board) => {
              const target = fpgaTargetFromBoard(board);
              return <button type="button" className={`template-card target-card ${board.device === targetDevice ? "selected" : ""}`} key={board.device} onClick={() => setTargetDevice(board.device)}><Cpu size={15}/><span className="template-category">{target.vendor}</span><strong>{target.family}</strong><p>{target.device}</p><span className="template-meta">{target.package} · {target.speedGrade}</span></button>;
            })}{!templates.length && !error && <div className="wizard-loading"><LoaderCircle className="spin" size={18}/> Loading registered project packages...</div>}</div>
          </section>
          <section className="wizard-pane project-options">
            <div className="wizard-pane-title"><strong>Project and board</strong><small>Only settings supported by the selected build route are editable</small></div>
            <div className="project-identity-fields"><label className="field-label">Display name<input value={displayName} maxLength={80} onChange={(event) => setDisplayName(event.target.value)} placeholder="SPI sensor interface"/></label><label className="field-label">Folder name<input className={!nameValid ? "invalid" : ""} value={folderName} maxLength={60} onChange={(event) => setFolderName(event.target.value)} spellCheck={false}/><small>{nameValid ? `projects/${folderName}` : "Use 06_lowercase_words format."}</small></label></div>
            <label className="field-label board-select">Physical board<select value={selectedBoard?.id ?? ""} onChange={(event) => setBoardId(event.target.value)}>{compatibleBoards.map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}</select></label>
            {selectedBoard && <div className="board-choice"><CircuitBoard size={19}/><div><strong>{selectedBoard.name}</strong><span>Sipeed board · {selectedBoard.programmer.transport}</span></div><span className="status-good"><ShieldCheck size={12}/> registered</span></div>}
            {mode === "custom" && selectedBoard && selectedTarget ? <div className="custom-project-fields">
              <div className="target-properties"><div><span>FPGA vendor</span><strong>{selectedTarget.vendor}</strong></div><div><span>Device</span><code title={selectedTarget.device}>{selectedTarget.device}</code></div><div><span>Package / speed</span><strong>{selectedTarget.package} · {selectedTarget.speedGrade}</strong></div><div><span>Toolchain</span><strong>{selectedBoard.build?.backend ?? "oss-cad-suite"}</strong></div><div><span>Programmer</span><strong>{selectedBoard.programmer.backend} / {selectedBoard.programmer.board}</strong></div></div>
              <div className="custom-field-grid"><label className="field-label">Top module<input value={top} onChange={(event) => setTop(event.target.value)} className={!validIdentifier.test(top) ? "invalid" : ""}/></label><label className="field-label">Timing target (MHz)<input type="number" min="0.1" max="1000" step="0.1" value={clockMhz} onChange={(event) => setClockMhz(event.target.value)}/></label></div>
              <label className="field-label">Clock signal<input value={selectedBoard.clocks[0]?.name ?? ""} readOnly/><small>Pin identity comes from the registered board package.</small></label>
              <label className="field-label">Constraint path<input value={constraintPath} onChange={(event) => setConstraintPath(event.target.value)} spellCheck={false}/></label>
              {selectedBoard.timingConstraints?.length ? <label className="field-label">Timing constraint path<input value={timingPath} onChange={(event) => setTimingPath(event.target.value)} spellCheck={false}/></label> : null}
              <div className="source-structure"><span>Portable source structure</span><code>rtl/</code><code>sim/</code><code>constraints/</code></div>
            </div> : <ul className="creation-list"><li><Check size={13}/> RTL, simulation, constraints, and documentation</li><li><Check size={13}/> Board-specific build and programmer settings</li><li><Check size={13}/> Generated build files excluded</li></ul>}
          </section>
        </div>
        {error && <div className="wizard-error">{error}</div>}
        <footer><span>{mode === "custom" ? "Custom settings are stored as portable project-relative configuration." : selectedTemplate && selectedBoard ? `${selectedTemplate.name} for ${selectedBoard.name}` : "Select a compatible template and board"}</span><button type="button" className="secondary-button" onClick={closeProjectWizard} disabled={loading}>Cancel</button><button type="submit" className="primary-button" disabled={!nameValid || !selectedBoard || loading || (mode === "template" ? !selectedTemplate : !customValid)}>{loading ? <LoaderCircle className="spin" size={15}/> : <FolderPlus size={15}/>} {loading ? "Creating safely..." : "Create project"}</button></footer>
      </form>
    </section>
  </div>;
}
