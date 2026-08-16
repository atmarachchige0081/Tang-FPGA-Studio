// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkbench } from "../store/workbench";
import { AnalysisView } from "./AnalysisView";
import { VerificationView } from "./VerificationView";

describe("design intelligence views", () => {
  beforeEach(() => {
    useWorkbench.setState({
      root: "Browser preview",
      project: "Demo",
      projectPath: ".",
      diagnostics: [],
      runningJob: null,
      view: "analysis",
    });
  });

  afterEach(() => cleanup());

  it("shows real analysis categories and architecture without inventing findings", async () => {
    render(<AnalysisView/>);
    expect(await screen.findByRole("heading", { name: "RTL analysis & architecture" })).toBeTruthy();
    expect(screen.getByText("Current RTL scan is clean")).toBeTruthy();
    expect(screen.getByText("Module hierarchy")).toBeTruthy();
    expect(screen.getByText("Clock & reset map")).toBeTruthy();
    expect(useWorkbench.getState().diagnostics).toEqual([]);
  });

  it("records explicit user evidence instead of inferring hardware behavior", async () => {
    render(<VerificationView onRun={vi.fn()}/>);
    expect(await screen.findByRole("heading", { name: "Evidence, not assumptions" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Observed behavior"), { target: { value: "LED blinks and UART replies PONG" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm pass" }));
    await waitFor(() => expect(screen.getByText(/User-confirmed board behavior/)).toBeTruthy());
  });
});
