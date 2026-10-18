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

  it("recovers when the interrupt request itself never resolves", async () => {
    vi.spyOn(bridge, "aiTurnStart").mockResolvedValue({ turn: { id: "stuck-turn", status: "inProgress" } });
    vi.spyOn(bridge, "aiTurnInterrupt").mockImplementation(() => new Promise(() => undefined));
    render(<AiPanel/>);
    fireEvent.click(await screen.findByRole("button", { name: /Connect agent/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Sign in with ChatGPT/i }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Ask AI about this project" }), { target: { value: "Check timing" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
    expect(await screen.findByRole("button", { name: /Connect agent/i }, { timeout: 7_000 })).toBeTruthy();
  }, 9_000);

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
  it("reconnects to a new project without asking for sign-in again", async () => {
    const connect = vi.spyOn(bridge, "aiConnect");
    const login = vi.spyOn(bridge, "aiLoginChatgpt");
    render(<AiPanel/>);
    fireEvent.click(await screen.findByRole("button", { name: /Connect agent/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Sign in with ChatGPT/i }));
    await screen.findByRole("textbox", { name: "Ask AI about this project" });
    useWorkbench.setState({ project: "Second project", projectPath: "projects/second" });
    await waitFor(() => expect(connect).toHaveBeenLastCalledWith("Browser preview", "projects/second"));
    await screen.findByRole("textbox", { name: "Ask AI about this project" });
    expect(screen.queryByRole("button", { name: /Sign in with ChatGPT/i })).toBeNull();
    expect(login).toHaveBeenCalledTimes(1);
  });

  it("steers a running turn without starting a second turn", async () => {
    const start = vi.spyOn(bridge, "aiTurnStart").mockResolvedValue({ turn: { id: "running-turn" } });
    const steer = vi.spyOn(bridge, "aiTurnSteer").mockResolvedValue({ turnId: "running-turn" });
    render(<AiPanel/>);
    fireEvent.click(await screen.findByRole("button", { name: /Connect agent/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Sign in with ChatGPT/i }));
    const input = await screen.findByRole("textbox", { name: "Ask AI about this project" });
    fireEvent.change(input, { target: { value: "Review timing" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByRole("button", { name: "Stop" });
    fireEvent.change(input, { target: { value: "Use Dock pins" } });
    fireEvent.click(screen.getByRole("button", { name: "Send follow-up" }));
    await waitFor(() => expect(steer).toHaveBeenCalledWith(expect.any(String), "running-turn", "Use Dock pins"));
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("keeps approval actions available with collapsed details and after a failed response", async () => {
    vi.spyOn(bridge, "aiRespondApproval").mockRejectedValue(new Error("Save the modified file first"));
    render(<AiPanel/>);
    fireEvent.click(await screen.findByRole("button", { name: /Connect agent/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Sign in with ChatGPT/i }));
    await screen.findByRole("textbox", { name: "Ask AI about this project" });
    window.dispatchEvent(new CustomEvent("fpga-ai-demo", { detail: {
      method: "item/commandExecution/requestApproval", requestId: 88,
      params: { command: "tool " + "output ".repeat(1000), cwd: "project" }, timestamp: new Date().toISOString(),
    } }));
    fireEvent.click(await screen.findByRole("button", { name: "Allow once" }));
    await screen.findByText("Save the modified file first");
    expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Allow once" }).closest(".ai-review-queue")).toBeTruthy();
  });

  it("restores unresolved provider approvals when a panel is mounted again", async () => {
    await bridge.aiConnect("Browser preview", ".");
    await bridge.aiLoginChatgpt(false);
    vi.spyOn(bridge, "aiPendingRequests").mockResolvedValue([{
      method: "item/commandExecution/requestApproval", requestId: 99,
      params: { command: "echo restore-review" }, timestamp: new Date().toISOString(),
    }]);
    render(<AiPanel/>);
    expect(await screen.findByRole("button", { name: "Allow once" })).toBeTruthy();
    expect(screen.getByText("echo restore-review")).toBeTruthy();
  });

  async function readyWithHistory() {
    vi.spyOn(bridge,"aiThreadList").mockResolvedValue({data:[{id:"saved-thread",name:"Saved conversation"}]});
    render(<AiPanel/>);
    fireEvent.click(await screen.findByRole("button",{name:/Connect agent/i}));
    fireEvent.click(await screen.findByRole("button",{name:/Sign in with ChatGPT/i}));
    await screen.findByRole("textbox",{name:"Ask AI about this project"});
  }
  it("prevents switching saved threads during a running turn",async()=>{
    const resume=vi.spyOn(bridge,"aiThreadResume");
    vi.spyOn(bridge,"aiTurnStart").mockResolvedValue({turn:{id:"running",status:"inProgress"}});
    await readyWithHistory();
    fireEvent.change(screen.getByRole("textbox",{name:"Ask AI about this project"}),{target:{value:"Explain"}});
    fireEvent.click(screen.getByRole("button",{name:"Send"}));
    await screen.findByRole("button",{name:"Stop"});
    fireEvent.click(screen.getByRole("button",{name:"AI conversation history"}));
    fireEvent.click(await screen.findByRole("button",{name:/Saved conversation/}));
    expect(resume).not.toHaveBeenCalled();
  });
  it("ignores history returned after switching projects",async()=>{
    let finish!: (value:Record<string,unknown>)=>void;
    vi.spyOn(bridge,"aiThreadResume").mockResolvedValue({thread:{id:"saved-thread"}});
    vi.spyOn(bridge,"aiThreadRead").mockReturnValue(new Promise(resolve=>{finish=resolve;}));
    await readyWithHistory();
    fireEvent.click(screen.getByRole("button",{name:"AI conversation history"}));
    fireEvent.click(await screen.findByRole("button",{name:/Saved conversation/}));
    await waitFor(()=>expect(bridge.aiThreadRead).toHaveBeenCalled());
    useWorkbench.setState({projectPath:"projects/new",project:"New"});
    await waitFor(()=>expect(screen.getByText("Project: New")).toBeTruthy());
    finish({thread:{turns:[{items:[{type:"agentMessage",id:"old",text:"STALE_HISTORY"}]}]}});
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(screen.queryByText("STALE_HISTORY")).toBeNull();
  });
  it("prevents clearing a conversation while its first thread is being created",async()=>{
    vi.spyOn(bridge,"aiThreadStart").mockReturnValue(new Promise(()=>undefined));
    await readyWithHistory();
    fireEvent.change(screen.getByRole("textbox",{name:"Ask AI about this project"}),{target:{value:"Explain"}});
    fireEvent.click(screen.getByRole("button",{name:"Send"}));
    await waitFor(()=>expect(bridge.aiThreadStart).toHaveBeenCalled());
    expect((screen.getByRole("button",{name:"New AI conversation"}) as HTMLButtonElement).disabled).toBe(true);
  });

  it("ignores an old account-refresh failure after switching projects",async()=>{
    await readyWithHistory();
    const account=await bridge.aiAccount(false);
    let reject!: (reason:Error)=>void;
    vi.spyOn(bridge,"aiAccount").mockReturnValueOnce(new Promise((_resolve,fail)=>{reject=fail;})).mockResolvedValue(account);
    window.dispatchEvent(new CustomEvent("fpga-ai-demo",{detail:{method:"account/updated",params:{},timestamp:""}}));
    await waitFor(()=>expect(bridge.aiAccount).toHaveBeenCalled());
    useWorkbench.getState().setWorkspace("Browser preview","New account project","other",[]);
    await screen.findByText("Project: New account project");
    reject(Error("STALE_ACCOUNT_ERROR"));
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(screen.queryByText("STALE_ACCOUNT_ERROR")).toBeNull();
  });

});
