import type { AiEvent } from "../types";

export interface AiChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  streaming?: boolean;
}

export interface AiActivityItem {
  id: string;
  kind: string;
  label: string;
  detail?: string;
  status: "running" | "completed" | "failed" | "declined";
  changes?: Array<{ path: string; kind: string; diff?: string }>;
}

export interface AiApprovalRequest {
  requestId: string | number;
  method: string;
  itemId?: string;
  title: string;
  reason?: string;
  command?: string;
  cwd?: string;
  changes: Array<{ path: string; kind: string; diff?: string }>;
  diff?: string;
  risk: "medium" | "high";
  proposedExecpolicyAmendment?: string[];
}

export interface AiQuestionRequest {
  requestId: string | number;
  questions: Array<{
    id: string;
    header: string;
    question: string;
    secret: boolean;
    options: Array<{ label: string; description: string }>;
  }>;
}

export interface AiConversationState {
  messages: AiChatMessage[];
  activities: AiActivityItem[];
  timeline: Array<{ type: "message" | "activity"; id: string }>;
  approvals: AiApprovalRequest[];
  questions: AiQuestionRequest[];
  running: boolean;
  turnId: string | null;
  diff: string;
  error: string | null;
}

export const initialAiConversation: AiConversationState = {
  messages: [],
  activities: [],
  timeline: [],
  approvals: [],
  questions: [],
  running: false,
  turnId: null,
  diff: "",
  error: null,
};

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function commandText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").join(" ");
  return undefined;
}

function activityDetail(value: string): string {
  const lines = value.split(/\r?\n/);
  const compact = lines.length > 10 ? [...lines.slice(0, 4), "…", ...lines.slice(-5)].join("\n") : value;
  return compact.length > 1_200 ? `${compact.slice(0, 600)}\n…\n${compact.slice(-550)}` : compact;
}

function changesFromItem(item: UnknownRecord): AiApprovalRequest["changes"] {
  if (!Array.isArray(item.changes)) return [];
  return item.changes.map((value) => {
    const change = record(value);
    const kind = typeof change.kind === "string" ? change.kind : string(record(change.kind).type) ?? "modify";
    return { path: string(change.path) ?? "unknown file", kind, diff: string(change.diff) };
  });
}

function activityFor(item: UnknownRecord): AiActivityItem | null {
  const id = string(item.id);
  const kind = string(item.type);
  if (!id || !kind) return null;
  if (kind === "commandExecution") {
    const command = commandText(item.command) ?? "project command";
    return { id, kind, label: "Running command", detail: command, status: "running" };
  }
  if (kind === "fileChange") {
    const changes = changesFromItem(item);
    return { id, kind, label: "Preparing changes", detail: changes.map((change) => change.path).join(", "), status: "running", changes };
  }
  if (kind === "reasoning") return { id, kind, label: "Analyzing project", status: "running" };
  if (kind === "mcpToolCall" || kind === "dynamicToolCall") return { id, kind, label: "Using project tool", detail: string(item.tool) ?? string(item.server), status: "running" };
  if (kind === "webSearch") return { id, kind, label: "Searching documentation", detail: string(item.query), status: "running" };
  return null;
}

function commandIsHighRisk(command: string | undefined): boolean {
  const normalized = ` ${(command ?? "").toLowerCase()}`;
  return ["remove-item", " rm ", " del ", "erase ", "format ", "diskpart", "git reset", "git clean", "git checkout --", " flash"].some((part) => normalized.includes(part));
}

function approvalFromEvent(state: AiConversationState, event: AiEvent): AiApprovalRequest | null {
  if (event.requestId === undefined) return null;
  const params = record(event.params);
  const itemId = string(params.itemId);
  if (event.method === "item/commandExecution/requestApproval") {
    const command = commandText(params.command);
    return {
      requestId: event.requestId,
      method: event.method,
      itemId,
      title: params.networkApprovalContext ? "Network access requested" : "Command approval required",
      reason: string(params.reason),
      command,
      cwd: string(params.cwd),
      changes: [],
      risk: commandIsHighRisk(command) || Boolean(params.networkApprovalContext) ? "high" : "medium",
      proposedExecpolicyAmendment: Array.isArray(params.proposedExecpolicyAmendment)
        ? params.proposedExecpolicyAmendment.filter((item): item is string => typeof item === "string")
        : undefined,
    };
  }
  if (event.method === "item/fileChange/requestApproval") {
    const activity = state.activities.find((item) => item.id === itemId);
    return {
      requestId: event.requestId,
      method: event.method,
      itemId,
      title: "Review file changes",
      reason: string(params.reason),
      changes: activity?.changes ?? [],
      diff: state.diff,
      risk: "medium",
    };
  }
  if (event.method === "item/tool/call") {
    const argumentsValue = record(params.arguments);
    const action = string(argumentsValue.action) ?? "unknown";
    const hardwareWrite = ["upload", "flash", "analyzer-upload"].includes(action);
    return {
      requestId: event.requestId,
      method: event.method,
      itemId: string(params.callId) ?? itemId,
      title: `Run FPGA ${action}`,
      reason: hardwareWrite
        ? "This workflow can program connected FPGA hardware. Review it before continuing."
        : "Codex wants to run this workflow through FPGA Studio's native job runner.",
      command: `Tang workflow: ${action}`,
      cwd: string(params.cwd),
      changes: [],
      risk: hardwareWrite ? "high" : "medium",
    };
  }
  return null;
}

export function reduceAiEvent(state: AiConversationState, event: AiEvent): AiConversationState {
  if (event.method === "turn/started") {
    const turn = record(event.params.turn);
    return { ...state, running: true, turnId: string(turn.id) ?? state.turnId, error: null };
  }
  if (event.method === "item/agentMessage/delta") {
    const id = string(event.params.itemId) ?? `assistant-${Date.now()}`;
    const delta = string(event.params.delta) ?? "";
    const existing = state.messages.find((message) => message.id === id);
    return {
      ...state,
      messages: existing
        ? state.messages.map((message) => message.id === id ? { ...message, text: message.text + delta, streaming: true } : message)
        : [...state.messages, { id, role: "assistant", text: delta, streaming: true }],
      timeline: existing ? state.timeline : [...state.timeline, { type: "message", id }],
    };
  }
  if (event.method === "item/commandExecution/outputDelta") {
    const id = string(event.params.itemId);
    const delta = string(event.params.delta) ?? "";
    if (!id || !delta) return state;
    return {
      ...state,
      activities: state.activities.map((activity) => activity.id === id
        ? { ...activity, detail: activityDetail(`${activity.detail ?? ""}${delta}`) }
        : activity),
    };
  }
  if (event.method === "item/started") {
    const item = record(event.params.item);
    const activity = activityFor(item);
    if (!activity) return state;
    return {
      ...state,
      activities: [...state.activities.filter((value) => value.id !== activity.id), activity].slice(-100),
      timeline: state.timeline.some((entry) => entry.type === "activity" && entry.id === activity.id)
        ? state.timeline : [...state.timeline, { type: "activity", id: activity.id }],
    };
  }
  if (event.method === "item/completed") {
    const item = record(event.params.item);
    const id = string(item.id);
    const status = string(item.status);
    const activities = id ? state.activities.map((activity) => activity.id === id ? { ...activity, status: status === "failed" ? "failed" as const : status === "declined" ? "declined" as const : "completed" as const } : activity) : state.activities;
    let messages = state.messages.map((message) => id && message.id === id ? { ...message, streaming: false } : message);
    if (id && string(item.type) === "agentMessage" && !messages.some((message) => message.id === id)) {
      const text = string(item.text) ?? string(item.message);
      if (text) messages = [...messages, { id, role: "assistant", text }];
    }
    const addedMessage = messages.length > state.messages.length && id;
    return { ...state, activities, messages, timeline: addedMessage ? [...state.timeline, { type: "message", id: addedMessage }] : state.timeline };
  }
  if (event.method === "turn/diff/updated") {
    return { ...state, diff: string(event.params.diff) ?? "" };
  }
  if (event.method.endsWith("/requestApproval") || event.method === "item/tool/call") {
    const approval = approvalFromEvent(state, event);
    return approval ? { ...state, approvals: [...state.approvals.filter((item) => item.requestId !== approval.requestId), approval] } : state;
  }
  if (event.method === "item/tool/requestUserInput" && event.requestId !== undefined) {
    const raw = Array.isArray(event.params.questions) ? event.params.questions : [];
    const questions = raw.slice(0, 3).map((value) => {
      const question = record(value);
      const id = string(question.id);
      const prompt = string(question.question);
      if (!id || !prompt) return null;
      const options = (Array.isArray(question.options) ? question.options : []).slice(0, 10).map((optionValue) => {
        const option = record(optionValue);
        return { label: string(option.label) ?? "Option", description: string(option.description) ?? "" };
      });
      return { id, header: string(question.header) ?? "Agent question", question: prompt, secret: question.isSecret === true, options };
    }).filter((question): question is AiQuestionRequest["questions"][number] => question !== null);
    if (!questions.length) return state;
    return { ...state, questions: [...state.questions.filter((item) => item.requestId !== event.requestId), { requestId: event.requestId, questions }] };
  }
  if (event.method === "serverRequest/resolved") {
    const requestId = event.params.requestId;
    return {
      ...state,
      approvals: state.approvals.filter((item) => item.requestId !== requestId),
      questions: state.questions.filter((item) => item.requestId !== requestId),
    };
  }
  if (event.method === "turn/completed") {
    const turn = record(event.params.turn);
    const error = record(turn.error);
    const message = string(error.message);
    const outcome = string(turn.status);
    return {
      ...state,
      running: false,
      turnId: null,
      error: message ?? null,
      approvals: [],
      questions: [],
      messages: state.messages.map((item) => ({ ...item, streaming: false })),
      activities: state.activities.map((item) => item.status === "running" ? {
        ...item, status: outcome === "failed" ? "failed" as const : outcome === "interrupted" ? "declined" as const : "completed" as const,
      } : item),
    };
  }
  if (event.method === "error" || event.method === "provider/protocolError" || event.method === "provider/stopped") {
    return {
      ...state, running: false, turnId: null, approvals: [], questions: [],
      messages: state.messages.map((item) => ({ ...item, streaming: false })),
      activities: state.activities.map((item) => item.status === "running" ? { ...item, status: "failed" as const } : item),
      error: string(event.params.message) ?? "The AI provider stopped unexpectedly.",
    };
  }
  return state;
}

export function appendUserMessage(state: AiConversationState, text: string): AiConversationState {
  const id = `user-${Date.now()}-${state.messages.length}`;
  return { ...state, messages: [...state.messages, { id, role: "user", text }], timeline: [...state.timeline, { type: "message", id }] };
}

export function conversationWithHistory(messages: AiChatMessage[]): AiConversationState {
  return { ...initialAiConversation, messages, timeline: messages.map(({ id }) => ({ type: "message", id })) };
}

export function removeApproval(state: AiConversationState, requestId: string | number): AiConversationState {
  return { ...state, approvals: state.approvals.filter((approval) => approval.requestId !== requestId) };
}

export function removeQuestion(state: AiConversationState, requestId: string | number): AiConversationState {
  return { ...state, questions: state.questions.filter((question) => question.requestId !== requestId) };
}

export function messagesFromThread(value: Record<string, unknown>): AiChatMessage[] {
  const thread = record(value.thread);
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  const messages: AiChatMessage[] = [];
  for (const turnValue of turns) {
    const turn = record(turnValue);
    const items = Array.isArray(turn.items) ? turn.items : [];
    for (const itemValue of items) {
      const item = record(itemValue);
      const type = string(item.type);
      const id = string(item.id) ?? `history-${messages.length}`;
      if (type === "userMessage") {
        const text = string(item.text) ?? string(item.message);
        if (text) messages.push({ id, role: "user", text });
      } else if (type === "agentMessage") {
        const text = string(item.text) ?? string(item.message);
        if (text) messages.push({ id, role: "assistant", text });
      }
    }
  }
  return messages;
}
