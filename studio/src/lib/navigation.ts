import { bridge } from "./bridge";
import { fileName, languageForPath } from "./language";
import { useWorkbench } from "../store/workbench";

export function workspacePath(root: string, projectPath: string, file: string): string {
  const normalizedRoot = root.replaceAll("\\", "/").replace(/\/$/, "");
  let normalized = file.replaceAll("\\", "/").replace(/^file:\/\/\//, "");
  if (normalized.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}/`)) normalized = normalized.slice(normalizedRoot.length + 1);
  normalized = normalized.replace(/^\.\//, "").replace(/^\//, "");
  const project = projectPath.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (!project || project === "." || normalized === project || normalized.startsWith(`${project}/`)) return normalized;
  return `${project}/${normalized}`;
}

export async function openWorkspaceLocation(file: string, line = 1, column = 1): Promise<void> {
  const state = useWorkbench.getState();
  const preferred = workspacePath(state.root, state.projectPath, file);
  const candidates = preferred === file ? [preferred] : [preferred, file.replaceAll("\\", "/")];
  let lastError: unknown;
  for (const path of candidates) {
    try {
      const content = await bridge.readText(state.root, path);
      state.openFile({ path, name: fileName(path), language: languageForPath(path), content, savedContent: content });
      state.navigateTo(path, line, column);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Cannot open ${file}`);
}
