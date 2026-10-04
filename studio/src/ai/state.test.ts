import { describe, expect, it } from "vitest";
import { appendUserMessage, initialAiConversation, messagesFromThread, reduceAiEvent } from "./state";
import type { AiEvent } from "../types";

function event(method: string, params: Record<string, unknown>, requestId?: string | number): AiEvent {
  return { method, params, requestId, timestamp: new Date(0).toISOString() };
}

describe("AI conversation protocol reducer", () => {
  it("streams one assistant message and completes it without duplication", () => {
    let state = reduceAiEvent(initialAiConversation, event("turn/started", { turn: { id: "turn-1" } }));
    state = reduceAiEvent(state, event("item/agentMessage/delta", { itemId: "answer-1", delta: "Hello " }));
    state = reduceAiEvent(state, event("item/agentMessage/delta", { itemId: "answer-1", delta: "FPGA" }));
    state = reduceAiEvent(state, event("item/completed", { item: { id: "answer-1", type: "agentMessage", status: "completed", text: "Hello FPGA" } }));
    expect(state.messages).toEqual([{ id: "answer-1", role: "assistant", text: "Hello FPGA", streaming: false }]);
    expect(state.running).toBe(true);
    state = reduceAiEvent(state, event("turn/completed", { turn: { id: "turn-1", status: "completed" } }));
    expect(state.running).toBe(false);
  });

  it("presents command and file approval requests with risk and diff context", () => {
    let state = reduceAiEvent(initialAiConversation, event("item/started", { item: { id: "edit-1", type: "fileChange", changes: [{ path: "rtl/top.sv", kind: { type: "update" }, diff: "+assign led = 1'b1;" }] } }));
    state = reduceAiEvent(state, event("turn/diff/updated", { diff: "diff --git a/rtl/top.sv b/rtl/top.sv" }));
    state = reduceAiEvent(state, event("item/fileChange/requestApproval", { itemId: "edit-1", reason: "Apply the reviewed patch" }, 4));
    state = reduceAiEvent(state, event("item/commandExecution/requestApproval", { itemId: "cmd-1", command: ["git", "reset", "--hard"], cwd: "." }, 5));
    expect(state.approvals[0]).toMatchObject({ requestId: 4, changes: [{ path: "rtl/top.sv" }] });
    expect(state.approvals[1]).toMatchObject({ requestId: 5, risk: "high" });
  });

  it("captures bounded structured agent questions", () => {
    const state = reduceAiEvent(initialAiConversation, event("item/tool/requestUserInput", {
      questions: [{ id: "board", header: "Board", question: "Which target?", options: [{ label: "Primer 20K", description: "Dock board" }] }],
    }, "question-1"));
    expect(state.questions).toEqual([{ requestId: "question-1", questions: [{ id: "board", header: "Board", question: "Which target?", secret: false, options: [{ label: "Primer 20K", description: "Dock board" }] }] }]);
  });

  it("preserves conversation history and user prompts", () => {
    const state = appendUserMessage(initialAiConversation, "Explain rtl/top.sv");
    expect(state.messages[0]?.role).toBe("user");
    expect(messagesFromThread({ thread: { turns: [{ items: [{ id: "u", type: "userMessage", text: "Question" }, { id: "a", type: "agentMessage", text: "Answer" }] }] } })).toHaveLength(2);
  });

  it("keeps project activity between the prompt and answer in event order", () => {
    let state = appendUserMessage(initialAiConversation, "Check timing");
    state = reduceAiEvent(state, event("item/started", { item: { id: "step-1", type: "reasoning" } }));
    state = reduceAiEvent(state, event("item/agentMessage/delta", { itemId: "answer-1", delta: "**Done.**" }));
    expect(state.timeline.map((entry) => entry.type)).toEqual(["message", "activity", "message"]);
    expect(state.timeline[1]?.id).toBe("step-1");
    state = reduceAiEvent(state, event("turn/completed", { turn: { id: "turn-1", status: "completed" } }));
    expect(state.activities[0]?.status).toBe("completed");
  });

  it("surfaces provider failure and releases the running state", () => {
    const running = { ...initialAiConversation, running: true, turnId: "turn-1" };
    const failed = reduceAiEvent(running, event("provider/stopped", { message: "Provider exited" }));
    expect(failed).toMatchObject({ running: false, error: "Provider exited" });
  });
});
