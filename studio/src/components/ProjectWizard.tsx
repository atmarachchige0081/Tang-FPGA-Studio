import { useEffect, useMemo, useState } from "react";
import { Check, CircuitBoard, FolderPlus, LoaderCircle, ShieldCheck, X } from "lucide-react";
import { bridge } from "../lib/bridge";
import { useWorkbench } from "../store/workbench";
import type { BoardProfile, ProjectTemplate } from "../types";

const validProjectName = /^\d{2}_[a-z][a-z0-9_]*$/;

export function ProjectWizard(): React.JSX.Element | null {
  const { projectWizardOpen, closeProjectWizard, root, setWorkspace, setBuild, setBoard } = useWorkbench();
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [boards, setBoards] = useState<BoardProfile[]>([]);
  const [templateId, setTemplateId] = useState("serial_commands");
  const [boardId, setBoardId] = useState("tang_primer_20k");
  const [folderName, setFolderName] = useState("06_my_fpga_project");
  const [displayName, setDisplayName] = useState("My FPGA project");
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
    }).catch((reason: unknown) => { if (!disposed) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { disposed = true; };
  }, [projectWizardOpen, root]);

  const selected = useMemo(() => templates.find((item) => item.id === templateId), [templates, templateId]);
  const compatibleBoards = useMemo(() => {
    const supported = selected?.supportedBoards?.length ? selected.supportedBoards : ["tang_primer_20k"];
    return boards.filter((board) => supported.includes(board.id));
  }, [boards, selected]);
  const selectedBoard = compatibleBoards.find((board) => board.id === boardId) ?? compatibleBoards[0];
  const nameValid = validProjectName.test(folderName);

  useEffect(() => {
    if (compatibleBoards[0] && !compatibleBoards.some((board) => board.id === boardId)) setBoardId(compatibleBoards[0].id);
  }, [compatibleBoards, boardId]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!nameValid || !selected || !selectedBoard || loading) return;
    setLoading(true); setError("");
    try {
      const snapshot = await bridge.createProject(root, folderName, templateId, displayName, selectedBoard.id);
      setWorkspace(snapshot.root, snapshot.project, snapshot.projectPath, snapshot.tree);
      const [summary, board] = await Promise.all([
        bridge.buildSummary(snapshot.root, snapshot.projectPath),
        bridge.activeBoard(snapshot.root, snapshot.projectPath),
      ]);
      setBuild(summary); setBoard(board); closeProjectWizard();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  if (!projectWizardOpen) return null;
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !loading) closeProjectWizard(); }}>
    <section className="project-wizard" role="dialog" aria-modal="true" aria-labelledby="wizard-title">
      <header><div className="wizard-symbol"><FolderPlus size={22}/></div><div><p className="eyebrow">Verified project generator</p><h1 id="wizard-title">Create an FPGA project</h1><p>Pick a tested lesson and FPGA Studio will show only compatible board packages.</p></div><button className="icon-button" onClick={closeProjectWizard} disabled={loading} aria-label="Close project wizard"><X size={17}/></button></header>
      <form onSubmit={(event) => void create(event)}>
        <div className="wizard-section-title"><span>1</span><div><strong>Choose a template</strong><small>Each starter includes synthesizable RTL and a self-checking simulation.</small></div></div>
        <div className="template-grid">{templates.map((template) => <button type="button" className={`template-card ${template.id === templateId ? "selected" : ""}`} key={template.id} onClick={() => setTemplateId(template.id)}><span className="template-check">{template.id === templateId && <Check size={12}/>}</span><span className="template-category">{template.category}</span><strong>{template.name}</strong><p>{template.description}</p><span className="template-meta">{template.level} - {template.hardwareReady ? "hardware ready" : "simulation first"}</span><span className="template-tags">{template.tags.map((tag) => <i key={tag}>{tag}</i>)}</span></button>)}{!templates.length && !error && <div className="wizard-loading"><LoaderCircle className="spin" size={18}/> Loading verified templates...</div>}</div>
        <div className="wizard-form-grid">
          <div><div className="wizard-section-title"><span>2</span><div><strong>Name the project</strong><small>Sortable folders keep lessons and examples organized.</small></div></div><label className="field-label">Display name<input value={displayName} maxLength={80} onChange={(event) => setDisplayName(event.target.value)} placeholder="SPI sensor interface"/></label><label className="field-label">Folder name<input className={!nameValid ? "invalid" : ""} value={folderName} maxLength={60} onChange={(event) => setFolderName(event.target.value)} spellCheck={false}/><small>{nameValid ? `projects/${folderName}` : "Use 06_lowercase_words format."}</small></label></div>
          <div><div className="wizard-section-title"><span>3</span><div><strong>Choose the target</strong><small>Incompatible boards are hidden to prevent confusing build errors.</small></div></div><label className="field-label board-select">Board package<select value={selectedBoard?.id ?? ""} onChange={(event) => setBoardId(event.target.value)}>{compatibleBoards.map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}</select></label>{selectedBoard && <div className="board-choice"><CircuitBoard size={27}/><div><strong>{selectedBoard.name}</strong><span>{selectedBoard.device} - {selectedBoard.clocks[0] ? `${selectedBoard.clocks[0].frequencyHz / 1_000_000} MHz` : "clock not declared"}{selectedBoard.build?.deviceVersion ? ` - revision ${selectedBoard.build.deviceVersion}` : ""}</span></div><span className="status-good"><ShieldCheck size={13}/> {selectedBoard.build?.backend === "gowin-eda" ? "Gowin EDA" : "OSS ready"}</span></div>}<ul className="creation-list"><li><Check size={13}/> RTL, simulation, constraints, and documentation</li><li><Check size={13}/> Project-specific device, build route, and programmer settings</li><li><Check size={13}/> No generated build files copied</li></ul></div>
        </div>
        {error && <div className="wizard-error">{error}</div>}
        <footer><span>{selected && selectedBoard ? `${selected.name} for ${selectedBoard.name}` : "Select a compatible template and board"}</span><button type="button" className="secondary-button" onClick={closeProjectWizard} disabled={loading}>Cancel</button><button type="submit" className="primary-button" disabled={!nameValid || !selected || !selectedBoard || loading}>{loading ? <LoaderCircle className="spin" size={15}/> : <FolderPlus size={15}/>} {loading ? "Creating safely..." : "Create project"}</button></footer>
      </form>
    </section>
  </div>;
}
