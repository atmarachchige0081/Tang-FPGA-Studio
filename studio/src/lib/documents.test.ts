import { describe, expect, it, vi } from "vitest";
import { confirmDiscardUnsaved, hasUnsavedChanges } from "./documents";

const file = (name: string, content: string, savedContent = content) => ({
  path: `rtl/${name}`,
  name,
  language: "systemverilog",
  content,
  savedContent,
});

describe("unsaved document protection", () => {
  it("does not interrupt clean document navigation", () => {
    const confirm = vi.fn(() => false);
    expect(confirmDiscardUnsaved([file("top.sv", "saved")], confirm)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("requires confirmation before dirty documents are discarded", () => {
    const tabs = [file("top.sv", "changed", "saved")];
    expect(hasUnsavedChanges(tabs)).toBe(true);
    expect(confirmDiscardUnsaved(tabs, () => false)).toBe(false);
    expect(confirmDiscardUnsaved(tabs, () => true)).toBe(true);
  });
});
