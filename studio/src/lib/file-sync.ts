import { useEffect } from "react";
import { bridge } from "./bridge";
import { useWorkbench } from "../store/workbench";

/** Poll metadata as well as AI events: shell edits and a closed assistant still sync. */
export function useProjectFileSync(): void {
  const root = useWorkbench((s) => s.root);
  const project = useWorkbench((s) => s.projectPath);
  useEffect(() => {
    if (!root) return;
    let disposed = false, busy = false, treeBusy = false, journalBusy = false;
    let journalRevision: number | undefined;
    const versions = new Map<string, string>();
    const reported = new Set<string>();
    const current = () => !disposed && useWorkbench.getState().root === root && useWorkbench.getState().projectPath === project;
    const sync = async () => {
      if (busy || !current()) return;
      busy = true;
      const paths = useWorkbench.getState().tabs.slice(0, 64).map((tab) => tab.path);
      for (const path of versions.keys()) if (!paths.includes(path)) versions.delete(path);
      try {
        const updates = await bridge.syncProjectFiles(root, project, paths.map((path) => ({ path, version: versions.get(path) ?? "" })));
        if (!current()) return;
        for (const update of updates) {
          if (update.error) {
            if (!reported.has(update.path)) { reported.add(update.path); useWorkbench.getState().appendOutput({jobId:"file-sync",phase:"refresh",stream:"stderr",message:`Cannot refresh ${update.path}: ${update.error}`,timestamp:new Date().toISOString()}); }
            continue;
          }
          reported.delete(update.path);
          versions.set(update.path, update.version);
          if (update.missing || update.content !== null) useWorkbench.getState().syncFile(update.path, update.content, update.missing);
        }
      } catch { /* Temporary writes/deletions are retried; never discard an editor buffer. */ }
      finally { busy = false; }
    };
    const tree = async () => {
      if (treeBusy || !current()) return;
      treeBusy = true;
      try {
        const nodes = await bridge.projectTree(root, project);
        if (current() && JSON.stringify(nodes) !== JSON.stringify(useWorkbench.getState().tree)) useWorkbench.getState().refreshProjectTree(nodes);
      } catch { /* Transient directories during generation are retried. */ }
      finally { treeBusy = false; }
    };
    const journal = async () => {
      if (journalBusy || !current()) return;
      journalBusy = true;
      try {
        const snapshot = await bridge.pollProjectChanges(root,project,journalRevision);
        if (!current()) return;
        journalRevision=snapshot.revision;
        if (snapshot.changes) useWorkbench.getState().setFileChanges(snapshot.changes,snapshot.limited,snapshot.revision);
      } catch { /* Keep the last review snapshot while a transient read is retried. */ }
      finally { journalBusy=false; }
    };
    const refresh = () => { void sync(); void tree(); void journal(); };
    const interval = window.setInterval(() => void sync(), 1000);
    const journalInterval = window.setInterval(() => void journal(),1500);
    const treeInterval = window.setInterval(() => void tree(), 5000);
    window.addEventListener("focus", refresh);
    window.addEventListener("fpga-studio:files-changed", refresh);
    let stop: (() => void) | undefined;
    void bridge.onAiEvent((event) => {
      if (event.method === "item/completed" || event.method === "turn/completed" || event.method === "item/fileChange/outputDelta") refresh();
    }).then((unlisten) => { if (disposed) unlisten(); else stop = unlisten; }).catch(() => undefined);
    refresh();
    return () => { disposed = true; stop?.(); clearInterval(interval); clearInterval(treeInterval); clearInterval(journalInterval); window.removeEventListener("focus", refresh); window.removeEventListener("fpga-studio:files-changed", refresh); };
  }, [root, project]);
}
