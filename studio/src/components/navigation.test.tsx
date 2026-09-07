// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkbench } from "../store/workbench";
import { QuickLauncher } from "./QuickLauncher";
import { TitleBar } from "./TitleBar";
import { ActivityBar } from "./ActivityBar";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";

describe("native navigation controls", () => {
  beforeEach(() => {
    useWorkbench.setState({
      project: "UART command console",
      activePath: "rtl/top.sv",
      runningJob: null,
      diagnostics: [],
      build: null,
      theme: "dark",
      view: "welcome",
    });
  });

  afterEach(() => cleanup());

  it("opens real toolbar menus and dispatches build actions", () => {
    const run = vi.fn();
    render(<TitleBar onRun={run} onSave={vi.fn()}/>);
    fireEvent.click(screen.getByRole("button", { name: "Build" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Run simulation" }));
    expect(run).toHaveBeenCalledWith("sim");
    expect(screen.queryByRole("menu")).toBeNull();
  }, 15_000);

  it("opens the Ctrl-K action center and navigates to UART", () => {
    render(<QuickLauncher onRun={vi.fn()} onSave={vi.fn()}/>);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByRole("dialog", { name: "FPGA Studio action center" })).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Search actions" }), { target: { value: "UART" } });
    fireEvent.click(screen.getByRole("button", { name: /Open UART terminal/i }));
    expect(useWorkbench.getState().view).toBe("uart");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("wires hardware navigation from both compact controls", () => {
    useWorkbench.setState({ activity: "hardware", view: "welcome" });
    render(<><ActivityBar/><Sidebar/></>);
    fireEvent.click(screen.getAllByRole("button", { name: "Open hardware manager" })[0]!);
    expect(useWorkbench.getState().view).toBe("hardware");
    useWorkbench.setState({ view: "welcome" });
    fireEvent.click(screen.getAllByRole("button", { name: "Open hardware manager" })[1]!);
    expect(useWorkbench.getState().view).toBe("hardware");
  });

  it("routes status actions to source control, problems, build, and output", () => {
    useWorkbench.setState({ activity: "explorer", bottomPanel: "terminal", bottomOpen: false, view: "welcome" });
    render(<StatusBar/>);
    fireEvent.click(screen.getByRole("button", { name: /Git/ }));
    expect(useWorkbench.getState().activity).toBe("source");
    fireEvent.click(screen.getAllByTitle("Open Problems")[0]!);
    expect(useWorkbench.getState().bottomPanel).toBe("problems");
    fireEvent.click(screen.getByTitle("Open build dashboard"));
    expect(useWorkbench.getState().view).toBe("dashboard");
    fireEvent.click(screen.getByRole("button", { name: "Open output notifications" }));
    expect(useWorkbench.getState().bottomPanel).toBe("output");
  });
});
