import { watchWorkspace } from "../lib/workspace-operation";
import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, LoaderCircle, X } from "lucide-react";
import { bridge } from "../lib/bridge";
import { confirmDiscardUnsaved } from "../lib/documents";
import { useWorkbench } from "../store/workbench";

type Candidate = { path: string; name: string; identification: string };

export function OpenProjectDialog(): React.JSX.Element | null {
  const [visible, setVisible] = useState(false);
  const [folder, setFolder] = useState("");
  const [projects, setProjects] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const reveal = () => { setVisible(true); setError(""); window.setTimeout(() => input.current?.focus(), 0); };
    window.addEventListener("fpga-studio:open-project", reveal);
    return () => window.removeEventListener("fpga-studio:open-project", reveal);
  }, []);

  const inspect = async (path: string) => {
    if (!path.trim() || lock.current) return;
    lock.current = true; setBusy(true); setError(""); setProjects([]); setSelected("");
    try {
      const recognized = await bridge.recognizeProjectFolder(path.trim());
      setProjects(recognized); setSelected(recognized[0]?.path ?? "");
    } catch (caught) { setError(String(caught)); }
    finally { lock.current = false; setBusy(false); }
  };
  const browse = async () => {
    try {
      const path = await open({ directory: true, multiple: false, title: "Open FPGA project folder" });
      if (typeof path === "string") { setFolder(path); await inspect(path); }
    } catch (caught) { setError(String(caught)); }
  };
  const load = async () => {
    if (!selected || lock.current) return;
    const state = useWorkbench.getState();
    if (state.runningJob) { setError("Wait for the current hardware or build task to finish before changing projects."); return; }
    if (!await confirmDiscardUnsaved(state.tabs)) return;
    lock.current = true; setBusy(true); setError("");
    const operation = watchWorkspace(state.root, state.projectPath);
    try {
      // Resolve everything before replacing the current editor state.
      const snapshot = await bridge.openProject(state.root, selected);
      if (!operation.current()) return;
      const [build, board] = await Promise.all([bridge.buildSummary(snapshot.root, snapshot.projectPath), bridge.activeBoard(snapshot.root, snapshot.projectPath)]);
      if (!operation.current()) return;
      state.setWorkspace(snapshot.root, snapshot.project, snapshot.projectPath, snapshot.tree, snapshot.recentProjects);
      state.setBuild(build); state.setBoard(board); state.setView("editor");
      setVisible(false);
    } catch (caught) { setError(String(caught)); }
    finally { operation.stop(); lock.current = false; setBusy(false); }
  };
  if (!visible) return null;
  return <div className="release-overlay" onKeyDown={(event) => { if (event.key === "Escape" && !busy) setVisible(false); }}>
    <section className="open-project-dialog" role="dialog" aria-modal="true" aria-labelledby="open-project-title">
      <header><h2 id="open-project-title">Open project</h2><button aria-label="Close open project" disabled={busy} onClick={() => setVisible(false)}><X size={18}/></button></header>
      <p>Select an existing Studio project, or a workspace containing several projects.</p>
      <form onSubmit={(event) => { event.preventDefault(); void inspect(folder); }}><label htmlFor="project-folder">Project folder</label><div><input id="project-folder" ref={input} value={folder} disabled={busy} onChange={(event) => { setFolder(event.target.value); setProjects([]); setSelected(""); }}/><button type="button" disabled={busy} onClick={() => void browse()}><FolderOpen size={16}/> Browse…</button></div><button disabled={busy || !folder.trim()}>Find projects</button></form>
      {error && <p className="open-project-error" role="alert">{error}</p>}
      {projects.length > 0 && <fieldset><legend>{projects.length === 1 ? "Recognized project" : "Choose a project"}</legend>{projects.map((project) => <label className="recognized-project" key={project.path}><input type="radio" name="recognized-project" value={project.path} checked={selected === project.path} onChange={() => setSelected(project.path)}/><span><strong>{project.name}</strong><span>{project.identification}</span><code>{project.path}</code></span></label>)}</fieldset>}
      <footer><span>Opening a folder does not run its scripts or program hardware.</span><button className="primary-button" disabled={busy || !selected} onClick={() => void load()}>{busy ? <LoaderCircle className="spin" size={16}/> : <FolderOpen size={16}/>} Open project</button></footer>
    </section>
  </div>;
}
