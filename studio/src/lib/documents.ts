import { confirm as nativeConfirm } from "@tauri-apps/plugin-dialog";
import { isTauri } from "@tauri-apps/api/core";
import { useWorkbench } from "../store/workbench";
import type { OpenFile } from "../types";

export function hasUnsavedChanges(tabs: OpenFile[]): boolean {
  return tabs.some((tab) => tab.content !== tab.savedContent);
}

export async function confirmAction(message: string): Promise<boolean> {
  try {
    // The plugin's window.confirm shim is asynchronous and calls a removed command.
    return isTauri()
      ? await nativeConfirm(message, { title: "Tang FPGA Studio", kind: "warning" })
      : await window.confirm(message);
  } catch (reason) {
    const state = useWorkbench.getState();
    state.setBottomPanel("output");
    state.appendOutput({ jobId: "dialog", phase: "confirmation", stream: "stderr", message: `Action cancelled: confirmation could not open. ${String(reason)}`, timestamp: new Date().toISOString() });
    return false;
  }
}

export async function confirmDiscardUnsaved(
  tabs: OpenFile[],
  confirm: (message: string) => boolean | Promise<boolean> = confirmAction,
): Promise<boolean> {
  const dirty = tabs.filter((tab) => tab.content !== tab.savedContent);
  if (!dirty.length) return true;
  const names = dirty.slice(0, 3).map((tab) => tab.name).join(", ");
  const remainder = dirty.length > 3 ? ` and ${dirty.length - 3} more` : "";
  return await confirm(`Discard unsaved changes in ${names}${remainder}?`);
}
