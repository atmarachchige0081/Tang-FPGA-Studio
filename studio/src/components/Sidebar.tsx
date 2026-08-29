import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, Braces, CaseSensitive, CheckCircle2, ChevronDown, ChevronRight, CirclePlus, FileCode2, Files, Folder, FolderOpen, GitBranch, MoreHorizontal, PackageCheck, RefreshCw, Search, Sparkles } from "lucide-react";
import { bridge } from "../lib/bridge";
import { searchableSymbols } from "../lib/hdl-intelligence";
import { fileName, languageForPath } from "../lib/language";
import { openWorkspaceLocation } from "../lib/navigation";
import { useWorkbench } from "../store/workbench";
import type { GitStatus, HdlPattern, PluginInfo, ProjectNode } from "../types";

function TreeNode({ node, depth = 0 }: { node: ProjectNode; depth?: number }): React.JSX.Element {
  const [expanded, setExpanded] = useState(depth < 1);
  const { root, openFile, appendOutput } = useWorkbench();
  const activate = async () => {
    if (node.kind === "directory") return setExpanded((value) => !value);
    try {
      const content = await bridge.readText(root, node.path);
      openFile({ path: node.path, name: fileName(node.path), language: languageForPath(node.path), content, savedContent: content });
    } catch (error) {
      appendOutput({ jobId: "editor", phase: "open", stream: "stderr", message: error instanceof Error ? error.message : String(error), timestamp: new Date().toISOString() });
    }
  };
  return <div><button className="tree-row" style={{ paddingLeft: `${8 + depth * 14}px` }} onClick={() => void activate()} title={node.path}>
    {node.kind === "directory" ? (expanded ? <ChevronDown size={13}/> : <ChevronRight size={13}/>) : <span className="tree-indent"/>}
    {node.kind === "directory" ? (expanded ? <FolderOpen size={15} className="folder-icon"/> : <Folder size={15} className="folder-icon"/>) : <FileCode2 size={14} className={node.name.endsWith(".sv") ? "hdl-icon" : "file-icon"}/>}<span>{node.name}</span>
  </button>{expanded && node.children?.map((child) => <TreeNode node={child} depth={depth + 1} key={child.path}/>)}</div>;
}

function Explorer(): React.JSX.Element {
  const { project, tree, hdlIndex, intelligenceStatus } = useWorkbench();
  const [outlineOpen, setOutlineOpen] = useState(true);
  return <><div className="sidebar-heading"><span>EXPLORER</span><div><button title="New file"><CirclePlus size={14}/></button><button title="Refresh"><RefreshCw size={14}/></button><button title="More"><MoreHorizontal size={14}/></button></div></div><div className="project-heading"><ChevronDown size={13}/><strong>{project.toUpperCase()}</strong></div><div className="tree-scroll">{tree.map((node) => <TreeNode node={node} key={node.path}/>)}</div><button className="outline-section" onClick={() => setOutlineOpen((value) => !value)}>{outlineOpen ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}<strong>HDL OUTLINE</strong><span>{hdlIndex?.symbols.length ?? 0} symbols</span></button>{outlineOpen && <div className="outline-tree">{hdlIndex?.modules.map((module) => <div key={`${module.file}:${module.name}`}><button onClick={() => void openWorkspaceLocation(module.file, module.line, 1)}><Braces size={12}/><strong>{module.name}</strong>{module.name === hdlIndex.top && <small>TOP</small>}</button>{hdlIndex.instances.filter((instance) => instance.parentModule === module.name).map((instance) => <button className="outline-instance" key={`${instance.file}:${instance.line}:${instance.instanceName}`} onClick={() => void openWorkspaceLocation(instance.file, instance.line, 1)}><span>└</span><code>{instance.instanceName}</code><small>{instance.moduleName}</small></button>)}</div>)}{intelligenceStatus === "indexing" && <div className="outline-state"><RefreshCw className="spin" size={12}/> Indexing project…</div>}{intelligenceStatus === "degraded" && <div className="outline-state warning"><AlertCircle size={12}/> Syntax highlighting remains available.</div>}</div>}<div className="outline-section"><ChevronRight size={13}/><strong>DEPENDENCIES</strong><span>{hdlIndex?.instances.length ?? 0} instances</span></div></>;
}

type SearchMode = "text" | "files" | "symbols";

function flattenFiles(nodes: ProjectNode[]): ProjectNode[] {
  return nodes.flatMap((node) => node.kind === "file" ? [node] : flattenFiles(node.children ?? []));
}

function WorkspaceSearch(): React.JSX.Element {
  const { root, projectPath, tree, hdlIndex, setHdlIndex, appendOutput } = useWorkbench();
  const [mode, setMode] = useState<SearchMode>("text");
  const [query, setQuery] = useState("");
  const [textResults, setTextResults] = useState<Array<{ file: string; line: number; column: number; preview: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const files = useMemo(() => flattenFiles(tree), [tree]);

  useEffect(() => {
    const reveal = (event: Event) => {
      const requested = (event as CustomEvent<{ mode?: SearchMode }>).detail?.mode;
      if (requested) setMode(requested);
      setQuery("");
    };
    window.addEventListener("fpga-studio:workspace-search", reveal);
    return () => window.removeEventListener("fpga-studio:workspace-search", reveal);
  }, []);

  useEffect(() => {
    if (hdlIndex || !root) return;
    setHdlIndex(null, "indexing");
    void bridge.hdlIndex(root, projectPath).then((value) => setHdlIndex(value, "ready")).catch(() => setHdlIndex(null, "degraded"));
  }, [hdlIndex, root, projectPath, setHdlIndex]);

  useEffect(() => {
    if (mode !== "text" || query.trim().length < 2) {
      setTextResults([]);
      setLoading(false);
      return;
    }
    let disposed = false;
    setLoading(true);
    setError("");
    const timer = window.setTimeout(() => {
      void bridge.searchProject(root, projectPath, query).then((results) => { if (!disposed) setTextResults(results); }).catch((reason: unknown) => { if (!disposed) setError(reason instanceof Error ? reason.message : String(reason)); }).finally(() => { if (!disposed) setLoading(false); });
    }, 220);
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [mode, query, root, projectPath]);

  const normalized = query.trim().toLowerCase();
  const fileResults = mode === "files" ? files.filter((file) => !normalized || file.path.toLowerCase().includes(normalized)).slice(0, 300) : [];
  const symbolResults = mode === "symbols" && hdlIndex ? searchableSymbols(hdlIndex, query) : [];
  const open = (file: string, line = 1, column = 1) => void openWorkspaceLocation(file, line, column).catch((reason: unknown) => appendOutput({ jobId: "search", phase: "open", stream: "stderr", message: reason instanceof Error ? reason.message : String(reason), timestamp: new Date().toISOString() }));
  const resultCount = mode === "text" ? textResults.length : mode === "files" ? fileResults.length : symbolResults.length;

  return <div className="workspace-search"><div className="sidebar-heading"><span>PROJECT SEARCH</span><strong>{resultCount}</strong></div><div className="search-modes" role="tablist"><button role="tab" aria-selected={mode === "text"} className={mode === "text" ? "active" : ""} onClick={() => setMode("text")}><CaseSensitive size={13}/> Text</button><button role="tab" aria-selected={mode === "files"} className={mode === "files" ? "active" : ""} onClick={() => setMode("files")}><Files size={13}/> Files</button><button role="tab" aria-selected={mode === "symbols"} className={mode === "symbols" ? "active" : ""} onClick={() => setMode("symbols")}><Braces size={13}/> Symbols</button></div><label className="workspace-search-input"><Search size={14}/><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={mode === "text" ? "Search project text" : mode === "files" ? "Go to file" : "Go to symbol"}/>{loading && <RefreshCw className="spin" size={13}/>}</label>{error && <div className="search-state error"><AlertCircle size={14}/>{error}</div>}<div className="search-results">{mode === "text" && textResults.map((result) => <button key={`${result.file}:${result.line}:${result.column}`} onClick={() => open(result.file, result.line, result.column)}><div><strong>{fileName(result.file)}</strong><code>{result.line}:{result.column}</code></div><span>{result.preview}</span><small>{result.file}</small></button>)}{mode === "files" && fileResults.map((file) => <button key={file.path} onClick={() => open(file.path)}><div><FileCode2 size={13}/><strong>{file.name}</strong></div><small>{file.path}</small></button>)}{mode === "symbols" && symbolResults.map((symbol) => <button key={`${symbol.file}:${symbol.line}:${symbol.name}`} onClick={() => open(symbol.file, symbol.line, symbol.column)}><div><Braces size={13}/><strong>{symbol.name}</strong><code>{symbol.kind}</code></div><span>{symbol.detail}</span><small>{symbol.file}:{symbol.line}</small></button>)}{!loading && normalized && !resultCount && <div className="search-state">No {mode} matches in the active project.</div>}{!normalized && <div className="search-state">{mode === "text" ? "Type at least two characters. Search skips generated build files." : mode === "files" ? "Type a filename, or browse every project file." : "Search modules, ports, signals, parameters, functions, and tasks."}</div>}</div></div>;
}

function Placeholder({ title, text, action }: { title: string; text: string; action: string }): React.JSX.Element {
  return <div className="sidebar-placeholder"><div className="sidebar-heading"><span>{title}</span></div><Sparkles size={28}/><p>{text}</p><button className="secondary-button">{action}</button></div>;
}

function IpLibrary(): React.JSX.Element {
  const { root, tabs, activePath, updateFile, setView, appendOutput } = useWorkbench();
  const [patterns, setPatterns] = useState<HdlPattern[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<HdlPattern | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!root) return;
    setLoading(true); setError(null);
    try { setPatterns(await bridge.hdlPatterns(root)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  }, [root]);
  useEffect(() => { void load(); }, [load]);
  const active = tabs.find((tab) => tab.path === activePath);
  const matches = patterns.filter((pattern) => `${pattern.title} ${pattern.summary} ${pattern.category} ${pattern.aliases.join(" ")}`.toLowerCase().includes(query.toLowerCase())).slice(0, 72);
  const insert = () => {
    if (!selected || !active) return;
    const separator = active.content.endsWith("\n") ? "\n" : "\n\n";
    updateFile(active.path, `${active.content}${separator}// ${selected.title}\n${selected.code}\n`);
    setView("editor");
    appendOutput({ jobId: "ip-library", phase: "insert", stream: "system", message: `Inserted '${selected.title}' into ${active.path}. Review signal names, then lint and simulate.`, timestamp: new Date().toISOString() });
  };
  if (selected) return <div className="ip-library"><div className="sidebar-heading"><button className="ip-back" onClick={() => setSelected(null)}><ArrowLeft size={14}/> Catalog</button></div><div className="ip-detail"><span className="ip-meta">{selected.category} - {selected.difficulty}</span><h3>{selected.title}</h3><p>{selected.summary}</p><div className="ip-badges"><span>{selected.synthesizable ? "Synthesizable RTL" : "Simulation only"}</span>{selected.aliases.map((alias) => <code key={alias}>{alias}</code>)}</div><pre><code>{selected.code}</code></pre><button className="primary-button" disabled={!active} onClick={insert}><FileCode2 size={14}/> {active ? `Insert into ${active.name}` : "Open an HDL file to insert"}</button><small>Patterns are learning references. Rename signals and add project-specific reset and clock handling before use.</small></div></div>;
  return <div className="ip-library"><div className="sidebar-heading"><span>HDL PATTERN LIBRARY</span><div><strong>{patterns.length}</strong><button title="Reload HDL patterns" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={13}/></button></div></div><label className="ip-search"><Search size={14}/><input aria-label="Search HDL patterns" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="FIFO, CDC, assertion..."/></label>{error ? <div className="sidebar-message error"><AlertCircle size={17}/><span>{error}</span><button className="secondary-button" onClick={() => void load()}>Try again</button></div> : loading && !patterns.length ? <div className="sidebar-message"><RefreshCw className="spin" size={17}/><span>Loading the local pattern catalog...</span></div> : <div className="ip-list">{matches.map((pattern) => <button key={pattern.title} onClick={() => setSelected(pattern)}><span><strong>{pattern.title}</strong><small>{pattern.category} - {pattern.difficulty}</small></span><ChevronRight size={13}/></button>)}</div>}<div className="ip-footer">{matches.length} matches - reviewed local examples</div></div>;
}

function SourceControl(): React.JSX.Element {
  const { root, openFile, appendOutput } = useWorkbench();
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!root) return;
    setLoading(true); setError("");
    try { setStatus(await bridge.gitStatus(root)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  }, [root]);
  useEffect(() => { void load(); }, [load]);
  const openChange = async (path: string) => {
    try {
      const content = await bridge.readText(root, path);
      openFile({ path, name: fileName(path), language: languageForPath(path), content, savedContent: content });
    } catch (reason) {
      appendOutput({ jobId: "git", phase: "open", stream: "stderr", message: reason instanceof Error ? reason.message : String(reason), timestamp: new Date().toISOString() });
    }
  };
  return <div className="provider-panel"><div className="sidebar-heading"><span>SOURCE CONTROL</span><button title="Refresh Git status" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={14}/></button></div>{error ? <div className="sidebar-message error"><AlertCircle size={19}/><span>{error}</span></div> : !status ? <div className="sidebar-message"><RefreshCw className="spin" size={18}/><span>Finding Git...</span></div> : !status.available || !status.repository ? <div className="sidebar-message error"><GitBranch size={23}/><strong>{status.available ? "Repository not found" : "Git not found"}</strong><span>{status.message}</span>{status.executable && <code>{status.executable}</code>}</div> : <><div className="provider-summary"><GitBranch size={19}/><div><strong>{status.branch ?? "Detached HEAD"}</strong><span>{status.message}</span></div><span>{status.changes.length}</span></div>{status.upstream && <div className="tracking-row"><span>{status.upstream}</span><span>up {status.ahead} / down {status.behind}</span></div>}<div className="change-list">{status.changes.map((change) => <button key={`${change.indexStatus}${change.worktreeStatus}:${change.path}`} onClick={() => void openChange(change.path)} title={change.path}><code>{change.indexStatus === " " ? change.worktreeStatus : change.indexStatus}</code><span>{change.path}</span></button>)}{!status.changes.length && <div className="sidebar-message compact"><CheckCircle2 size={20}/><span>Working tree clean</span></div>}</div><div className="ip-footer">{status.version} - read-only status</div></>}</div>;
}

function Extensions(): React.JSX.Element {
  const { root } = useWorkbench();
  const [items, setItems] = useState<PluginInfo[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!root) return;
    setLoading(true); setError("");
    try { setItems(await bridge.plugins(root)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  }, [root]);
  useEffect(() => { void load(); }, [load]);
  return <div className="provider-panel"><div className="sidebar-heading"><span>LOCAL PROVIDERS</span><div><strong>{items.filter((item) => item.valid).length}</strong><button title="Reload plugin manifests" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={14}/></button></div></div>{error ? <div className="sidebar-message error"><AlertCircle size={19}/><span>{error}</span></div> : loading && !items.length ? <div className="sidebar-message"><RefreshCw className="spin" size={18}/><span>Validating plugin manifests...</span></div> : <div className="provider-list">{items.map((item) => <article key={item.id} className={item.valid ? "" : "invalid"}><div className="provider-icon">{item.valid ? <PackageCheck size={17}/> : <AlertCircle size={17}/>}</div><div><strong>{item.name}</strong><span>{item.kind} - v{item.version}</span><small>{item.message}</small><div>{item.capabilities.map((capability) => <code key={capability}>{capability}</code>)}</div></div></article>)}{!items.length && <div className="sidebar-message"><Sparkles size={22}/><span>No plugin manifests found in <code>plugins/</code>.</span></div>}</div>}<div className="ip-footer">Declarative only - no arbitrary native code</div></div>;
}

export function Sidebar(): React.JSX.Element {
  const activity = useWorkbench((state) => state.activity);
  const panels: Record<typeof activity, React.JSX.Element> = {
    explorer: <Explorer/>,
    search: <WorkspaceSearch/>,
    source: <SourceControl/>,
    hardware: <Placeholder title="HARDWARE" text="Programmers, boards, and serial connections are managed here." action="Scan devices"/>,
    ip: <IpLibrary/>,
    extensions: <Extensions/>,
  };
  return <aside className="sidebar">{panels[activity]}</aside>;
}
