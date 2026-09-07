import type { OpenFile } from "../types";

export function hasUnsavedChanges(tabs: OpenFile[]): boolean {
  return tabs.some((tab) => tab.content !== tab.savedContent);
}

export function confirmDiscardUnsaved(
  tabs: OpenFile[],
  confirm: (message: string) => boolean = window.confirm,
): boolean {
  const dirty = tabs.filter((tab) => tab.content !== tab.savedContent);
  if (!dirty.length) return true;
  const names = dirty.slice(0, 3).map((tab) => tab.name).join(", ");
  const remainder = dirty.length > 3 ? ` and ${dirty.length - 3} more` : "";
  return confirm(`Discard unsaved changes in ${names}${remainder}?`);
}
