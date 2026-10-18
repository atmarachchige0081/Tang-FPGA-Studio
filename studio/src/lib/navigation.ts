import { watchWorkspace } from "./workspace-operation";
import { bridge } from "./bridge";
import { fileName, languageForPath } from "./language";
import { useWorkbench } from "../store/workbench";

export function workspacePath(root: string, projectPath: string, file: string): string {
  const normalizedRoot = root.replaceAll("\\", "/").replace(/\/$/, "");
  const windows = /^(?:[A-Za-z]:\/|\/\/)/.test(normalizedRoot);
  const comparable = (value: string) => windows ? value.toLowerCase() : value;
  let normalized = file.replaceAll("\\", "/");
  if (/^file:/i.test(normalized)) {
    const url = new URL(normalized);
    normalized = decodeURIComponent(url.pathname);
    if (url.hostname) normalized = `//${url.hostname}${normalized}`;
    else if (/^\/[A-Za-z]:\//.test(normalized)) normalized = normalized.slice(1);
  }
  const absolute = /^(?:\/|[A-Za-z]:\/)/.test(normalized);
  if (comparable(normalized).startsWith(`${comparable(normalizedRoot)}/`)) normalized = normalized.slice(normalizedRoot.length + 1);
  else if (absolute) throw new Error(`Source path is outside the active workspace: ${file}`);
  normalized = normalized.replace(/^\.\//, "");
  const project = projectPath.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (!project || project === "." || comparable(normalized) === comparable(project) || comparable(normalized).startsWith(`${comparable(project)}/`)) return normalized;
  return `${project}/${normalized}`;
}

export async function openWorkspaceLocation(file: string, line = 1, column = 1): Promise<void> {
  const state = useWorkbench.getState();
  const preferred = workspacePath(state.root, state.projectPath, file);
  const candidates = preferred === file ? [preferred] : [preferred, file.replaceAll("\\", "/")];
  const operation = watchWorkspace(state.root, state.projectPath);
  try {
    const existing = state.tabs.find((tab) => candidates.includes(tab.path));
    if (existing) {
      state.openFile(existing); state.navigateTo(existing.path, line, column); return;
    }
    let lastError: unknown;
    for (const path of candidates) {
      try {
        if (!operation.current()) return;
        const content = await bridge.readText(state.root, path);
        if (!operation.current()) return;
        state.openFile({ path, name: fileName(path), language: languageForPath(path), content, savedContent: content });
        state.navigateTo(path, line, column);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`Cannot open ${file}`);
  } finally { operation.stop(); }
}
