import { watchWorkspace } from "./workspace-operation";
import { bridge } from "./bridge";
import { useWorkbench } from "../store/workbench";
import type { OpenFile } from "../types";

/** Persist the submitted snapshot, keeping edits made during the write dirty. */
export async function persistFile(root: string, project: string, file: OpenFile): Promise<boolean> {
  const operation = watchWorkspace(root, project, file.path);
  try {
    if (!operation.current()) return false;
    await bridge.writeText(root, file.path, file.content);
    if (!operation.current()) return false;
    useWorkbench.getState().markSaved(file.path, file.content);
    return true;
  } finally { operation.stop(); }
}
