// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bridge } from "../lib/bridge";
import { useWorkbench } from "../store/workbench";
import { HardwareView } from "./WorkbenchViews";

describe("Linux hardware recovery", () => {
  beforeEach(async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (X11; Linux x86_64)");
    const board = (await bridge.boards("Browser preview")).find((item) => item.id === "tang_primer_20k");
    useWorkbench.setState({ root: "Browser preview", projectPath: ".", board, output: [] });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("shows udev and dialout guidance without opening the Windows repair helper", async () => {
    const driver = vi.spyOn(bridge, "launchZadig");
    vi.spyOn(bridge, "run").mockResolvedValue({ jobId: "linux", action: "detect", success: false, exitCode: 1, durationMs: 1, diagnostics: [], failureMessage: "Windows cannot open JTAG Interface 0. Install WinUSB on Interface 0 only." });
    render(<HardwareView/>);
    expect(await screen.findByRole("heading", { name: "Linux USB and serial access" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Detect JTAG/i }));
    await waitFor(() => expect(screen.getByText("JTAG needs attention")).toBeTruthy());
    expect(driver).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Open Zadig" })).toBeNull();
  });
});
