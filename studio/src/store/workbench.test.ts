import { beforeEach, describe, expect, it } from "vitest";
import { readStoredTheme, useWorkbench, writeStoredTheme } from "./workbench";

const source = {
  path: "rtl/top.sv",
  name: "top.sv",
  language: "systemverilog",
  content: "module top; endmodule\n",
  savedContent: "module top; endmodule\n",
};

describe("workbench document state", () => {
  beforeEach(() => {
    useWorkbench.setState({ tabs: [], activePath: null, view: "welcome", output: [], diagnostics: [], runningJob: null });
  });

  it("opens each document only once", () => {
    useWorkbench.getState().openFile(source);
    useWorkbench.getState().openFile(source);
    expect(useWorkbench.getState().tabs).toHaveLength(1);
    expect(useWorkbench.getState().activePath).toBe(source.path);
  });

  it("tracks dirty and saved source content", () => {
    useWorkbench.getState().openFile(source);
    useWorkbench.getState().updateFile(source.path, "module changed; endmodule\n");
    let tab = useWorkbench.getState().tabs[0];
    expect(tab?.content).not.toBe(tab?.savedContent);
    useWorkbench.getState().markSaved(source.path);
    tab = useWorkbench.getState().tabs[0];
    expect(tab?.content).toBe(tab?.savedContent);
  });

  it("does not mark edits made during an asynchronous save as persisted", () => {
    useWorkbench.getState().openFile(source);
    const submitted = "module submitted; endmodule\n";
    useWorkbench.getState().updateFile(source.path, submitted);
    useWorkbench.getState().updateFile(source.path, "module newer_edit; endmodule\n");
    useWorkbench.getState().markSaved(source.path, submitted);
    const tab = useWorkbench.getState().tabs[0];
    expect(tab?.savedContent).toBe(submitted);
    expect(tab?.content).not.toBe(tab?.savedContent);
  });

  it("bounds streamed output to 2,000 entries", () => {
    for (let index = 0; index < 2_050; index += 1) {
      useWorkbench.getState().appendOutput({ jobId: "test", phase: "sim", stream: "stdout", message: String(index), timestamp: new Date(0).toISOString() });
    }
    expect(useWorkbench.getState().output).toHaveLength(2_000);
    expect(useWorkbench.getState().output[0]?.message).toBe("50");
  });

  it("deduplicates consecutive backend events", () => {
    const event = { jobId: "build-1", phase: "build", stream: "stdout" as const, message: "Starting FPGA toolchain job", timestamp: new Date(0).toISOString() };
    useWorkbench.getState().appendOutput(event);
    useWorkbench.getState().appendOutput({ ...event, timestamp: new Date(1).toISOString() });
    expect(useWorkbench.getState().output).toEqual([event]);
  });
});

describe("workbench theme persistence", () => {
  it("rejects corrupt theme values and tolerates blocked storage", () => {
    expect(readStoredTheme({ getItem: () => "corrupt" })).toBe("dark");
    expect(readStoredTheme({ getItem: () => { throw new Error("blocked"); } })).toBe("dark");
    expect(() => writeStoredTheme("light", { setItem: () => { throw new Error("blocked"); } })).not.toThrow();
  });
});
