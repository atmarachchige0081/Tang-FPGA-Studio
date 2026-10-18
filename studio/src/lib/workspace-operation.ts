import { useWorkbench } from "../store/workbench";

/** Invalidate async results even if the user switches away and back. */
export function watchWorkspace(root: string, project: string, filePath?: string) {
  let valid = useWorkbench.getState().root === root && useWorkbench.getState().projectPath === project;
  const stop = useWorkbench.subscribe((state) => {
    if (state.root !== root || state.projectPath !== project || (filePath && !state.tabs.some((tab) => tab.path === filePath))) valid = false;
  });
  return { current: () => valid, stop };
}
