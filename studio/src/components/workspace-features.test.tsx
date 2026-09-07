// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useWorkbench } from "../store/workbench";
import { BottomDock } from "./BottomDock";
import { ProjectWizard } from "./ProjectWizard";
import { Sidebar } from "./Sidebar";

const tree = [{ name: "rtl", path: "rtl", kind: "directory" as const, children: [{ name: "top.sv", path: "rtl/top.sv", kind: "file" as const }] }];

describe("configurable project and navigation UI", () => {
  beforeEach(() => {
    useWorkbench.setState({
      root: "Browser preview",
      project: "Demo",
      projectPath: ".",
      tree,
      recentProjects: [],
      tabs: [],
      activePath: null,
      projectWizardOpen: false,
      activity: "explorer",
      bottomPanel: "problems",
      bottomOpen: true,
      diagnostics: [],
      hdlIndex: null,
      intelligenceStatus: "idle",
    });
  });

  afterEach(() => cleanup());

  it("creates a custom project from separately presented board and FPGA target settings", async () => {
    useWorkbench.setState({ projectWizardOpen: true });
    render(<ProjectWizard/>);
    fireEvent.click(await screen.findByRole("tab", { name: /Custom project/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /Project name/i }), { target: { value: "UART Terminal v1" } });
    expect(await screen.findByText("FPGA vendor")).toBeTruthy();
    expect(screen.getByText("Physical board")).toBeTruthy();
    expect(screen.getByText("Portable paths follow this project automatically")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    await waitFor(() => expect(useWorkbench.getState().projectWizardOpen).toBe(false));
    expect(useWorkbench.getState().projectPath).toBe("projects/UART Terminal v1");
  });

  it("groups Problems by severity and opens the exact source location", async () => {
    useWorkbench.setState({ diagnostics: [{ severity: "error", source: "yosys", message: "Unknown signal", file: "rtl/top.sv", line: 12, column: 7, code: "HDL" }] });
    render(<BottomDock/>);
    expect(screen.getByText("ERROR")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Unknown signal/i }));
    await waitFor(() => expect(useWorkbench.getState().activePath).toBe("rtl/top.sv"));
    expect(useWorkbench.getState().navigation).toMatchObject({ path: "rtl/top.sv", line: 12, column: 7 });
  });

  it("provides keyboard-style file and symbol search in the project sidebar", async () => {
    useWorkbench.setState({ activity: "search" });
    render(<Sidebar/>);
    fireEvent.change(screen.getByRole("textbox", { name: "Find in project" }), { target: { value: "logic" } });
    await waitFor(() => expect(screen.getByText(/logic \[23:0\] counter/i)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Toggle Replace" }));
    expect(screen.getByRole("textbox", { name: "Replace in project" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /Files/i }));
    fireEvent.change(screen.getByRole("textbox", { name: "Find in project" }), { target: { value: "" } });
    expect(screen.getByRole("button", { name: /top\.sv/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /Symbols/i }));
    expect(await screen.findByRole("button", { name: /top.*module/i })).toBeTruthy();
  });

  it("creates files and refreshes the Explorer without discarding the workspace", async () => {
    render(<Sidebar/>);
    fireEvent.click(screen.getByRole("button", { name: "New file" }));
    fireEvent.change(screen.getByRole("textbox", { name: "New file path" }), { target: { value: "rtl/new_uart.sv" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(useWorkbench.getState().activePath).toBe("rtl/new_uart.sv"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh Explorer" }));
    await waitFor(() => expect(useWorkbench.getState().output.some((event) => event.phase === "refresh")).toBe(true));
  });
});
