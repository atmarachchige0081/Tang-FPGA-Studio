// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bridge } from "../lib/bridge";
import { useWorkbench } from "../store/workbench";
import { OpenProjectDialog } from "./OpenProjectDialog";

beforeEach(() => { useWorkbench.setState({ root: "Browser preview", projectPath: ".", project: "Original", tabs: [], runningJob: null }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function selectFolder() {
  act(() => { window.dispatchEvent(new Event("fpga-studio:open-project")); });
  fireEvent.change(screen.getByLabelText("Project folder"), { target: { value: "C:/My Labs/UART" } });
  fireEvent.click(screen.getByRole("button", { name: "Find projects" }));
}

describe("open project folder", () => {
  it("recognizes and opens an external project without running an FPGA command", async () => {
    const open = vi.spyOn(bridge, "openProject");
    const run = vi.spyOn(bridge, "run");
    render(<OpenProjectDialog/>); await selectFolder();
    await screen.findByText("Preview project");
    fireEvent.click(screen.getByRole("button", { name: "Open project" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("Browser preview", "C:/My Labs/UART"));
    await waitFor(() => expect(useWorkbench.getState().view).toBe("editor"));
    expect(run).not.toHaveBeenCalled();
  });

  it("keeps the current project when recognition fails", async () => {
    vi.spyOn(bridge, "recognizeProjectFolder").mockRejectedValue(new Error("No Studio project found"));
    render(<OpenProjectDialog/>); await selectFolder();
    await screen.findByRole("alert");
    expect(useWorkbench.getState().project).toBe("Original");
    expect((screen.getByRole("button", { name: "Open project" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
it("clears the previous selection before a subsequent recognition failure",async()=>{
 vi.spyOn(bridge,"recognizeProjectFolder").mockResolvedValueOnce([{path:"old",name:"Old candidate",identification:"Studio"}]).mockRejectedValueOnce(Error("Cannot inspect"));
 render(<OpenProjectDialog/>);await selectFolder();await screen.findByText("Old candidate");
 fireEvent.click(screen.getByRole("button",{name:"Find projects"}));await screen.findByRole("alert");
 expect((screen.getByRole("button",{name:"Open project"}) as HTMLButtonElement).disabled).toBe(true);
});
it("does not overwrite a newer workspace when project loading completes late",async()=>{
 let finish!: (value:Awaited<ReturnType<typeof bridge.openProject>>)=>void;
 vi.spyOn(bridge,"openProject").mockReturnValue(new Promise(resolve=>{finish=resolve;}));
 render(<OpenProjectDialog/>);await selectFolder();await screen.findByText("Preview project");
 fireEvent.click(screen.getByRole("button",{name:"Open project"}));
 await waitFor(()=>expect(bridge.openProject).toHaveBeenCalled());
 act(()=>useWorkbench.getState().setWorkspace("elsewhere","Newer project",".",[]));
 await act(async()=>finish({root:"old",project:"Late project",projectPath:".",tree:[],recentProjects:[]}));
 expect(useWorkbench.getState().project).toBe("Newer project");
});
