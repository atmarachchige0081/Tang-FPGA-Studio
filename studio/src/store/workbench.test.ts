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

  it("shows external edits immediately in a clean buffer", () => {
    useWorkbench.getState().openFile(source);
    useWorkbench.getState().syncFile(source.path, "module ai_edit; endmodule", false);
    const tab = useWorkbench.getState().tabs[0];
    expect(tab?.content).toBe("module ai_edit; endmodule");
    expect(tab?.savedContent).toBe(tab?.content);
    expect(tab?.externallyUpdated).toBeGreaterThan(0);
  });
  it("preserves unsaved edits and exposes an explicit conflict choice", () => {
    useWorkbench.getState().openFile(source);
    useWorkbench.getState().updateFile(source.path, "my local edits");
    useWorkbench.getState().syncFile(source.path, "external changes", false);
    expect(useWorkbench.getState().tabs[0]?.content).toBe("my local edits");
    expect(useWorkbench.getState().tabs[0]?.externalContent).toBe("external changes");
    useWorkbench.getState().keepLocalFile(source.path);
    expect(useWorkbench.getState().tabs[0]?.content).toBe("my local edits");
    expect(useWorkbench.getState().tabs[0]?.savedContent).toBe("external changes");
    expect(useWorkbench.getState().tabs[0]?.externalContent).toBeUndefined();
  });
  it("keeps a deleted file's buffer and accepts a later recreated disk version", () => {
    useWorkbench.getState().openFile(source);
    useWorkbench.getState().syncFile(source.path, null, true);
    expect(useWorkbench.getState().tabs[0]?.content).toBe(source.content);
    expect(useWorkbench.getState().tabs[0]?.externalMissing).toBe(true);
    useWorkbench.getState().syncFile(source.path, "recreated", false);
    expect(useWorkbench.getState().tabs[0]?.externalMissing).toBe(false);
    expect(useWorkbench.getState().tabs[0]?.content).toBe("recreated");
  });

  it("does not resurrect an already reviewed change from an older polling response", () => {
    useWorkbench.setState({fileChanges:[],fileChangeRevision:5});
    useWorkbench.getState().setFileChanges([{path:"rtl/top.sv",before:"old",after:"new",kind:"modified",revision:4,hunks:[]}],false,4);
    expect(useWorkbench.getState().fileChanges).toHaveLength(0);
    expect(useWorkbench.getState().fileChangeRevision).toBe(5);
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

it("clears file-specific AI selection and cursor when switching tabs",()=>{
 useWorkbench.setState({tabs:[],activePath:null});
 useWorkbench.getState().openFile(source);
 useWorkbench.getState().setEditorSelection("private selection from first file");
 useWorkbench.getState().setEditorCursor(40,7);
 useWorkbench.getState().openFile({...source,path:"rtl/other.sv"});
 expect(useWorkbench.getState().editorSelection).toBe("");
 expect(useWorkbench.getState().editorCursor).toBeNull();
});
it("clears old project build, board, git and diagnostics when setting a new workspace",()=>{
 useWorkbench.setState({diagnostics:[{file:"old.sv",line:1,column:1,severity:"error",message:"old diagnostic",source:"old"}],git:{available:true,repository:true,branch:"old",changes:[],ahead:0,behind:0,message:""}});
 useWorkbench.getState().setWorkspace("new","New",".",[]);
 expect(useWorkbench.getState().diagnostics).toEqual([]);
 expect(useWorkbench.getState().git).toBeNull();
});
