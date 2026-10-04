// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bridge } from "../lib/bridge";
import { useWorkbench } from "../store/workbench";
import type { AiEvent } from "../types";
import { AiPanel } from "./AiPanel";

describe("native AI Assistant panel", () => {
  beforeEach(async () => {
    localStorage.clear();
    await bridge.aiLogout();
    await bridge.aiDisconnect();
    Object.defineProperty(Element.prototype, "scrollIntoView", { value: () => undefined, configurable: true });
    useWorkbench.setState({
      root: "Browser preview",
      project: "Demo FPGA",
      projectPath: ".",
      ready: true,
      tabs: [],
      activePath: null,
      editorSelection: "",
      editorCursor: null,
      output: [],
      diagnostics: [],
      git: null,
      aiPanelOpen: true,
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    cleanup();
    await bridge.aiLogout();
    await bridge.aiDisconnect();
  });

  it("lists provider models and sends the selected model and supported effort", async () => {
    const startTurn = vi.spyOn(bridge, "aiTurnStart");
    render(<AiPanel/>);
    fireEvent.click(await screen.findByRole("button", { name: /Connect agent/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Sign in with ChatGPT/i }));
    const model = await screen.findByRole("combobox", { name: "AI model" }) as HTMLSelectElement;
    await waitFor(() => expect(model.options.length).toBeGreaterThan(1));
    fireEvent.change(model, { target: { value: "preview-deep" } });
    fireEvent.change(screen.getByRole("combobox", { name: "AI reasoning effort" }), { target: { value: "high" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Ask AI about this project" }), { target: { value: "Review my RTL" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(startTurn).toHaveBeenCalledWith(
      expect.any(String), "Review my RTL", expect.any(Object), "preview-deep", "high",
    ));
  });

  it("connects, authenticates, sends a turn, and renders its streamed answer", async () => {
    render(<AiPanel/>);
    fireEvent.click(await screen.findByRole("button", { name: /Connect agent/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Sign in with ChatGPT/i }));
    const composer = await screen.findByRole("textbox", { name: "Ask AI about this project" });
    fireEvent.change(composer, { target: { value: "Explain the active module" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText(/Preview mode is ready/i)).toBeTruthy();
    await waitFor(() => expect((screen.getByRole("textbox", { name: "Ask AI about this project" }) as HTMLTextAreaElement).disabled).toBe(false));
  });

  it("disconnects and makes the panel recoverable when Stop cannot reach the provider", async () => {
    vi.spyOn(bridge, "aiTurnStart").mockResolvedValue({ turn: { id: "blocked-turn", status: "inProgress" } });
    vi.spyOn(bridge, "aiTurnInterrupt").mockRejectedValue(new Error("interrupt timed out"));
    render(<AiPanel/>);
    fireEvent.click(await screen.findByRole("button", { name: /Connect agent/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Sign in with ChatGPT/i }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Ask AI about this project" }), { target: { value: "Check timing" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
    expect(await screen.findByRole("button", { name: /Connect agent/i })).toBeTruthy();
  });

  it("renders an agent follow-up question and returns the selected answer", async () => {
    render(<AiPanel/>);
    fireEvent.click(await screen.findByRole("button", { name: /Connect agent/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Sign in with ChatGPT/i }));
    await screen.findByRole("textbox", { name: "Ask AI about this project" });
    const question: AiEvent = {
      method: "item/tool/requestUserInput",
      requestId: 19,
      params: { questions: [{ id: "target", header: "Target", question: "Which board?", options: [{ label: "Primer 20K", description: "Use the Dock profile" }] }] },
      timestamp: new Date(0).toISOString(),
    };
    window.dispatchEvent(new CustomEvent("fpga-ai-demo", { detail: question }));
    fireEvent.click(await screen.findByRole("button", { name: /Primer 20K/i }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.queryByText("Which board?")).toBeNull());
  });
});
