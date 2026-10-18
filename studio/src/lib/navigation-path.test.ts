import { describe, expect, it } from "vitest";
import { workspacePath } from "./navigation";

describe("workspace diagnostic paths", () => {
  it("maps project-relative, workspace-relative, and absolute paths", () => {
    const root = "C:/work/fpga";
    expect(workspacePath(root, "projects/demo", "rtl/top.sv")).toBe("projects/demo/rtl/top.sv");
    expect(workspacePath(root, "projects/demo", "projects/demo/rtl/top.sv")).toBe("projects/demo/rtl/top.sv");
    expect(workspacePath(root, "projects/demo", "C:/work/fpga/projects/demo/rtl/top.sv")).toBe("projects/demo/rtl/top.sv");
  });
});
it("decodes escaped file URIs without losing POSIX absolute paths",()=>{
 expect(workspacePath("/work/My Labs","demo","file:///work/My%20Labs/demo/rtl/top.sv")).toBe("demo/rtl/top.sv");
});
it("does not mistake a case-distinct POSIX root for the active workspace",()=>{
 expect(()=>workspacePath("/work/FPGA","demo","/work/fpga/rtl/top.sv")).toThrow(/outside/i);
});
it("retains Windows case-insensitive paths and decodes Windows file URIs",()=>{
 expect(workspacePath("C:/My Labs","demo","file:///c:/My%20Labs/demo/rtl/top.sv")).toBe("demo/rtl/top.sv");
});
