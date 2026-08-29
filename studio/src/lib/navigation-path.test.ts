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
