// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmAction, confirmDiscardUnsaved, hasUnsavedChanges } from "./documents";

const file = (name: string, content: string, savedContent = content) => ({
  path: `rtl/${name}`,
  name,
  language: "systemverilog",
  content,
  savedContent,
});

describe("unsaved document protection", () => {
  it("does not interrupt clean document navigation", async () => {
    const confirm = vi.fn(() => false);
    expect(await confirmDiscardUnsaved([file("top.sv", "saved")], confirm)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("requires confirmation before dirty documents are discarded", async () => {
    const tabs = [file("top.sv", "changed", "saved")];
    expect(hasUnsavedChanges(tabs)).toBe(true);
    expect(await confirmDiscardUnsaved(tabs, () => false)).toBe(false);
    expect(await confirmDiscardUnsaved(tabs, () => true)).toBe(true);
  });
});

const native = vi.hoisted(() => ({ confirm: vi.fn(), isTauri: vi.fn(() => false) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: native.confirm }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: native.isTauri }));
import { useWorkbench } from "../store/workbench";
import capability from "../../src-tauri/capabilities/default.json";
afterEach(() => { vi.restoreAllMocks(); native.isTauri.mockReturnValue(false); native.confirm.mockReset(); });

describe("native confirmation boundaries", () => {
  it("uses the supported dialog API rather than the broken window shim", async () => {
    native.isTauri.mockReturnValue(true);
    const shim = vi.spyOn(window, "confirm").mockImplementation(() => { throw Error("removed command"); });
    native.confirm.mockResolvedValue(false);
    expect(await confirmAction("Replace?" )).toBe(false);
    expect(native.confirm).toHaveBeenCalledWith("Replace?", { title: "Tang FPGA Studio", kind: "warning" });
    expect(shim).not.toHaveBeenCalled();
    expect(capability.permissions).toContain("dialog:allow-message");
  });
  it("does not authorize discard while a native answer is pending", async () => {
    native.isTauri.mockReturnValue(true);
    let answer!: (value: boolean) => void;
    native.confirm.mockReturnValue(new Promise<boolean>((resolve) => { answer = resolve; }));
    const discard = vi.fn();
    const pending = confirmDiscardUnsaved([file("top.sv", "dirty", "saved")]).then((ok) => { if (ok) discard(); });
    await Promise.resolve();
    expect(discard).not.toHaveBeenCalled();
    answer(false); await pending;
    expect(discard).not.toHaveBeenCalled();
    native.confirm.mockResolvedValue(true);
    expect(await confirmDiscardUnsaved([file("top.sv", "dirty", "saved")])).toBe(true);
  });
  it("cancels the action and reports a dialog failure", async () => {
    native.isTauri.mockReturnValue(true);
    native.confirm.mockRejectedValue(Error("permission denied"));
    useWorkbench.setState({ output: [] });
    expect(await confirmAction("Restart?")).toBe(false);
    expect(useWorkbench.getState().output.at(-1)?.message).toContain("Action cancelled: confirmation could not open");
  });
});
