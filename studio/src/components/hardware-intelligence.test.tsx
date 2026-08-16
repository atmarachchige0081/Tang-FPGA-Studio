// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkbench } from "../store/workbench";
import type { WaveformData } from "../types";
import { CaptureWaveform, DesignHealthView, LogicAnalyzerView, TraceabilityView } from "./HardwareIntelligence";

describe("3.0 hardware intelligence", () => {
  beforeEach(() => {
    useWorkbench.setState({
      root: "Browser preview",
      project: "Hardware Intelligence Demo",
      projectPath: ".",
      runningJob: null,
      view: "traceability",
    });
  });

  afterEach(() => cleanup());

  it("shows cross-layer timing and physical evidence", async () => {
    render(<TraceabilityView/>);
    expect(await screen.findByRole("heading", { name: "Traceability explorer" })).toBeTruthy();
    expect(screen.getByText("Implementation timing")).toBeTruthy();
    expect(screen.getByText("Cross-layer index", { exact: false })).toBeTruthy();
    expect(screen.getAllByText("measured").length).toBeGreaterThan(0);
  });

  it("configures probes without silently starting a hardware job", async () => {
    const run = vi.fn(async () => true);
    render(<LogicAnalyzerView onRun={run}/>);
    expect(await screen.findByRole("heading", { name: "Hardware Analyzer" })).toBeTruthy();
    expect(screen.getByText("Observable hierarchy")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /counter/i }));
    expect(run).not.toHaveBeenCalled();
  });

  it("explains why an optimization recommendation applies", async () => {
    render(<DesignHealthView onRun={vi.fn(async () => true)}/>);
    expect(await screen.findByRole("heading", { name: "Design Health" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Measure a retiming experiment/i }));
    await waitFor(() => expect(screen.getByText("Why this recommendation")).toBeTruthy());
    expect(screen.getByText(/Complete preview implementation/)).toBeTruthy();
  });

  it("inspects every captured channel with zoom, ordering, cursor values, and radix", () => {
    const waveform: WaveformData = {
      path: "capture.bin", timescale: "1 sample", endTime: 3, truncated: false,
      signals: [
        { id: "clk", name: "clk", scope: "top", width: 1, samples: [{ time: 0, value: "0" }, { time: 1, value: "1" }] },
        { id: "state", name: "state", scope: "top.uart", width: 2, samples: [{ time: 0, value: "00" }, { time: 2, value: "11" }] },
      ],
    };
    render(<CaptureWaveform waveform={waveform} triggerIndex={2}/>);
    fireEvent.click(screen.getByTitle("Zoom in"));
    expect(screen.getByText("2×")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("state radix"), { target: { value: "decimal" } });
    expect(screen.getByText("3")).toBeTruthy();
    const secondTrace = screen.getByLabelText("state waveform").querySelector("polyline")?.getAttribute("points") ?? "";
    expect(secondTrace).toContain(",10");
    expect(secondTrace).not.toMatch(/,(?:5[0-9]|[6-9][0-9])/);
    const moveUpButtons = screen.getAllByTitle("Move signal up");
    expect(moveUpButtons).toHaveLength(2);
    fireEvent.click(moveUpButtons[1]!);
    const reordered = screen.getAllByLabelText(/waveform/);
    expect(reordered[0]?.getAttribute("aria-label")).toBe("state waveform");
  });
});
