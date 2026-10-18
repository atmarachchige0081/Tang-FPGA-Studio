// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as documents from "../lib/documents";
import { bridge } from "../lib/bridge";
import { useWorkbench } from "../store/workbench";
import type { ProjectReplaceSummary } from "../types";
import { Sidebar } from "./Sidebar";

const source = { path: "rtl/top.sv", name: "top.sv", language: "systemverilog", content: "module before; endmodule", savedContent: "module before; endmodule" };
const replaced = "module after; endmodule";
const summary = { files: [source.path], filesChanged: 1, replacements: 1 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(async () => {
  const hdlIndex = await bridge.hdlIndex("Browser preview", ".");
  useWorkbench.setState({ root: "workspace-a", projectPath: ".", project: "A", activity: "search", tree: [], tabs: [{ ...source }], activePath: source.path, hdlIndex, output: [] });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.spyOn(bridge, "hdlIndex").mockResolvedValue(hdlIndex);
  vi.spyOn(bridge, "searchProject").mockResolvedValue([{ file: source.path, line: 1, column: 8, preview: source.content }]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function startReplacement(waitForStart = true) {
  const ui = render(<Sidebar/>);
  fireEvent.change(screen.getByLabelText("Find in project"), { target: { value: "before" } });
  await screen.findByText(source.content);
  fireEvent.click(screen.getByRole("button", { name: "Toggle Replace" }));
  fireEvent.change(screen.getByLabelText("Replace in project"), { target: { value: "after" } });
  fireEvent.click(screen.getByRole("button", { name: "Replace all matches" }));
  if (waitForStart) await waitFor(() => expect(vi.mocked(bridge.replaceProject).mock.calls.length > 0 || screen.queryByText(/Save modified matching files/)).toBeTruthy());
  return ui;
}
async function completed() {
  await waitFor(() => expect(useWorkbench.getState().output.some((entry) => entry.phase === "replace")).toBe(true));
}

describe("project replacement preserves live editor state", () => {
  it("does not replace before approval or after cancellation", async () => {
    const approval = deferred<boolean>();
    vi.spyOn(documents, "confirmAction").mockReturnValue(approval.promise);
    const replace = vi.spyOn(bridge, "replaceProject").mockResolvedValue(summary);
    await startReplacement(false);
    expect(replace).not.toHaveBeenCalled();
    await act(async () => approval.resolve(false));
    expect(replace).not.toHaveBeenCalled();
    expect(useWorkbench.getState().tabs[0]).toEqual(source);
  });

  it("refreshes a still-clean matching file", async () => {
    vi.spyOn(bridge, "replaceProject").mockResolvedValue(summary);
    vi.spyOn(bridge, "readText").mockResolvedValue(replaced);
    await startReplacement(); await completed();
    expect(useWorkbench.getState().tabs[0]).toMatchObject({ content: replaced, savedContent: replaced, externalContent: undefined });
  });
  it("keeps the refusal to replace an already dirty matching file", async () => {
    const replace = vi.spyOn(bridge, "replaceProject").mockResolvedValue(summary);
    useWorkbench.getState().updateFile(source.path, "my unsaved text");
    await startReplacement();
    await screen.findByText(/Save modified matching files/);
    expect(replace).not.toHaveBeenCalled();
    expect(window.confirm).not.toHaveBeenCalled();
  });
  it("preserves typing while the replacement is pending", async () => {
    const pending = deferred<ProjectReplaceSummary>();
    vi.spyOn(bridge, "replaceProject").mockReturnValue(pending.promise);
    vi.spyOn(bridge, "readText").mockResolvedValue(replaced);
    await startReplacement();
    act(() => useWorkbench.getState().updateFile(source.path, "typed while replacing"));
    await act(async () => pending.resolve(summary));
    await completed();
    expect(useWorkbench.getState().tabs[0]).toMatchObject({ content: "typed while replacing", savedContent: source.savedContent, externalContent: replaced });
  });
  it("preserves typing while the follow-up disk read is pending", async () => {
    const pending = deferred<string>();
    vi.spyOn(bridge, "replaceProject").mockResolvedValue(summary);
    const read = vi.spyOn(bridge, "readText").mockReturnValue(pending.promise);
    await startReplacement(); await waitFor(() => expect(read).toHaveBeenCalled());
    act(() => useWorkbench.getState().updateFile(source.path, "typed while refreshing"));
    await act(async () => pending.resolve(replaced));
    await completed();
    expect(useWorkbench.getState().tabs[0]).toMatchObject({ content: "typed while refreshing", externalContent: replaced });
  });
  it.each(["workspace", "project"])("does not inject old file contents into another %s", async (scope) => {
    const pending = deferred<string>();
    vi.spyOn(bridge, "replaceProject").mockResolvedValue(summary);
    const read = vi.spyOn(bridge, "readText").mockReturnValue(pending.promise);
    await startReplacement(); await waitFor(() => expect(read).toHaveBeenCalled());
    const otherFile = { ...source, content: "other project source", savedContent: "other project source" };
    act(() => useWorkbench.setState({ root: scope === "workspace" ? "workspace-b" : "workspace-a", projectPath: scope === "project" ? "other-project" : ".", tabs: [otherFile] }));
    await act(async () => pending.resolve(replaced));
    await completed();
    expect(useWorkbench.getState().tabs[0]).toEqual(otherFile);
  });
  it("ignores a late read after switching away and back to the original project", async () => {
    const pending = deferred<string>();
    vi.spyOn(bridge, "replaceProject").mockResolvedValue(summary);
    const read = vi.spyOn(bridge, "readText").mockReturnValue(pending.promise);
    await startReplacement(); await waitFor(() => expect(read).toHaveBeenCalled());
    act(() => useWorkbench.setState({ projectPath: "elsewhere" }));
    const reopened = { ...source, content: "reopened source", savedContent: "reopened source" };
    act(() => useWorkbench.setState({ projectPath: ".", tabs: [reopened] }));
    await act(async () => pending.resolve(replaced));
    await completed();
    expect(useWorkbench.getState().tabs[0]).toEqual(reopened);
  });
  it("ignores a pending refresh after the search panel unmounts", async () => {
    const pending = deferred<string>();
    vi.spyOn(bridge, "replaceProject").mockResolvedValue(summary);
    const read = vi.spyOn(bridge, "readText").mockReturnValue(pending.promise);
    const ui = await startReplacement(); await waitFor(() => expect(read).toHaveBeenCalled());
    ui.unmount();
    await act(async () => pending.resolve(replaced));
    await completed();
    expect(useWorkbench.getState().tabs[0]).toEqual(source);
  });
  it("refreshes the latest search query instead of restoring obsolete matches", async () => {
    const pending = deferred<ProjectReplaceSummary>();
    vi.spyOn(bridge, "replaceProject").mockReturnValue(pending.promise);
    vi.spyOn(bridge, "readText").mockResolvedValue(replaced);
    const search = vi.mocked(bridge.searchProject).mockImplementation(async (_root, _project, query) => [{ file: source.path, line: 1, column: 1, preview: query === "different" ? "current query result" : source.content }]);
    await startReplacement();
    fireEvent.change(screen.getByLabelText("Find in project"), { target: { value: "different" } });
    await screen.findByText("current query result");
    await act(async () => pending.resolve(summary));
    await completed();
    await waitFor(() => expect(search).toHaveBeenCalledTimes(3));
    expect(search.mock.calls.map((call) => call[2])).toEqual(["before", "different", "different"]);
    expect(screen.getByText("current query result")).toBeTruthy();
  });

});
