import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Bot, Check, ChevronDown, ChevronRight, CircleStop, Code2,
  Copy, FileDiff, History, KeyRound, LoaderCircle, LogOut, MessageSquarePlus, Play,
  RefreshCw, RotateCcw, Send, Settings2, ShieldCheck, TerminalSquare, UserRound, X,
} from "lucide-react";
import { bridge } from "../lib/bridge";
import { openWorkspaceLocation } from "../lib/navigation";
import { useWorkbench } from "../store/workbench";
import type { AiAccountStatus, AiApprovalDecision, AiEvent, AiLoginResult, AiModel, AiProviderStatus } from "../types";
import { MarkdownMessage } from "./MarkdownMessage";
import {
  appendUserMessage, conversationWithHistory, initialAiConversation, messagesFromThread, reduceAiEvent, removeApproval, removeQuestion,
  type AiActivityItem, type AiApprovalRequest, type AiConversationState, type AiQuestionRequest,
} from "./state";
import {
  readActiveThread, readAiSettings, writeActiveThread, writeAiSettings,
  type AiSettings,
} from "./persistence";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function valueString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function responseThreadId(value: UnknownRecord): string | null {
  return valueString(record(value.thread).id) ?? null;
}

interface ThreadSummary {
  id: string;
  name: string;
  preview: string;
  updatedAt?: number;
}

function threadSummaries(value: UnknownRecord): ThreadSummary[] {
  const raw = Array.isArray(value.data) ? value.data : [];
  return raw.map((entry): ThreadSummary | null => {
    const thread = record(entry);
    const id = valueString(thread.id);
    if (!id) return null;
    return {
      id,
      name: valueString(thread.name) ?? valueString(thread.preview) ?? "FPGA coding session",
      preview: valueString(thread.preview) ?? "",
      updatedAt: typeof thread.updatedAt === "number" ? thread.updatedAt : undefined,
    };
  }).filter((entry): entry is ThreadSummary => Boolean(entry));
}

function accountLabel(account: AiAccountStatus | null): string {
  if (!account?.account) return "Not signed in";
  if (account.account.type === "chatgpt") return account.account.email ?? `ChatGPT ${account.account.planType ?? "account"}`;
  if (account.account.type === "apiKey") return "OpenAI API key";
  return account.account.type;
}

function modelsFromResponse(value: UnknownRecord): AiModel[] {
  const data = Array.isArray(value.data) ? value.data : [];
  return data.map((entry): AiModel | null => {
    const model = record(entry);
    const id = valueString(model.model) ?? valueString(model.id);
    if (!id || model.hidden === true) return null;
    const efforts = Array.isArray(model.supportedReasoningEfforts) ? model.supportedReasoningEfforts : [];
    return {
      id: valueString(model.id) ?? id,
      model: id,
      displayName: valueString(model.displayName) ?? id,
      isDefault: model.isDefault === true,
      defaultReasoningEffort: valueString(model.defaultReasoningEffort),
      supportedReasoningEfforts: efforts.map((entry) => {
        const option = record(entry);
        return { reasoningEffort: valueString(option.reasoningEffort) ?? "", description: valueString(option.description) };
      }).filter((option) => option.reasoningEffort),
    };
  }).filter((entry): entry is AiModel => entry !== null);
}

function requestChanges(event: AiEvent, workspaceRoot: string): string[] {
  const item = record(event.params.item);
  if (valueString(item.type) !== "fileChange" || !Array.isArray(item.changes)) return [];
  const root = workspaceRoot.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
  return item.changes.map((change) => valueString(record(change).path)).filter((path): path is string => Boolean(path)).map((path) => {
    const normalized = path.replaceAll("\\", "/");
    return normalized.toLowerCase().startsWith(`${root}/`) ? normalized.slice(root.length + 1) : normalized;
  });
}

function formatDiagnostic(value: { severity: string; file?: string; line?: number; message: string }): string {
  const location = value.file ? `${value.file}${value.line ? `:${value.line}` : ""}: ` : "";
  return `${value.severity.toUpperCase()} ${location}${value.message}`;
}

function ActivityGroup({ activities }: { activities: AiActivityItem[] }): React.JSX.Element {
  const running = activities.some((activity) => activity.status === "running");
  const failed = activities.some((activity) => activity.status === "failed" || activity.status === "declined");
  const [expanded, setExpanded] = useState(running || failed);
  useEffect(() => { if (!running && !failed) setExpanded(false); }, [running, failed]);
  return <section className="ai-work-group" aria-label="Agent activity">
    <button className="ai-work-summary" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
      {running ? <LoaderCircle className="spin" size={13}/> : failed ? <AlertTriangle size={13}/> : <Check size={13}/>}
      <span>{running ? "Working on this answer" : failed ? "Work needs attention" : "Work completed"}</span>
      <small>{activities.length} {activities.length === 1 ? "step" : "steps"}</small>
      {expanded ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}
    </button>
    {expanded && <div className="ai-activities">{activities.map((activity) => <div key={activity.id} className={activity.status}><span>{activity.status === "running" ? <LoaderCircle className="spin" size={12}/> : activity.status === "completed" ? <Check size={12}/> : <AlertTriangle size={12}/>}</span><div><strong>{activity.label}</strong>{activity.detail && <code>{activity.detail}</code>}</div></div>)}</div>}
  </section>;
}

function ApprovalCard({
  approval, busy, onDecision,
}: {
  approval: AiApprovalRequest;
  busy: boolean;
  onDecision: (decision: AiApprovalDecision) => void;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(true);
  return <article className={`ai-approval ${approval.risk}`}>
    <header><ShieldCheck size={16}/><div><strong>{approval.title}</strong><span>{approval.risk === "high" ? "High-risk operation" : "Your approval is required"}</span></div><button aria-label="Toggle approval details" onClick={() => setExpanded((value) => !value)}>{expanded ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}</button></header>
    {expanded && <div className="ai-approval-body">
      {approval.reason && <p>{approval.reason}</p>}
      {approval.command && <div className="ai-command-preview"><TerminalSquare size={14}/><code>{approval.command}</code></div>}
      {approval.cwd && <small>Working directory: {approval.cwd}</small>}
      {approval.changes.map((change) => <div className="ai-change-row" key={`${change.kind}:${change.path}`}><FileDiff size={13}/><strong>{change.path}</strong><span>{change.kind}</span>{change.diff && <pre>{change.diff}</pre>}</div>)}
      {approval.diff && !approval.changes.some((change) => change.diff) && <pre className="ai-diff-preview">{approval.diff}</pre>}
      <div className="ai-approval-actions">
        <button disabled={busy} className="ai-deny" onClick={() => onDecision("deny")}>Reject</button>
        <button disabled={busy} onClick={() => onDecision("allowOnce")}>Allow once</button>
        {approval.method === "item/fileChange/requestApproval" && <button disabled={busy} onClick={() => onDecision("allowSession")}>Allow session</button>}
        {approval.method === "item/fileChange/requestApproval" && <button disabled={busy} className="ai-accept" onClick={() => onDecision("alwaysAllow")}>Always allow</button>}
        <button disabled={busy} title="Reject this request and stop the agent" onClick={() => onDecision("cancel")}><CircleStop size={13}/> Cancel agent</button>
      </div>
    </div>}
  </article>;
}

function SignIn({
  onChatGpt, onDeviceCode, onApiKey, onCancelLogin, busy, login,
}: {
  onChatGpt: () => void;
  onDeviceCode: () => void;
  onApiKey: (key: string) => void;
  onCancelLogin: () => void;
  busy: boolean;
  login: AiLoginResult | null;
}): React.JSX.Element {
  const [showKey, setShowKey] = useState(false);
  const [key, setKey] = useState("");
  const copyCode = () => login?.userCode && void navigator.clipboard?.writeText(login.userCode);
  return <div className="ai-signin">
    <Bot size={28}/><h3>Connect your AI coding agent</h3>
    <p>Use your own ChatGPT account through the official Codex sign-in, or use an OpenAI API key with separate API billing.</p>
    <button className="primary-button" disabled={busy} onClick={onChatGpt}>{busy ? <LoaderCircle className="spin" size={15}/> : <UserRound size={15}/>} Sign in with ChatGPT</button>
    <button className="secondary-button" disabled={busy} onClick={onDeviceCode}><KeyRound size={15}/> Use device code</button>
    {login?.userCode && <div className="ai-device-code"><span>Enter this code on the secure OpenAI page</span><button onClick={copyCode}><code>{login.userCode}</code><Copy size={13}/></button></div>}
    {login?.loginId && <button className="ai-text-button" disabled={busy} onClick={onCancelLogin}>Cancel sign-in</button>}
    <button className="ai-text-button" onClick={() => setShowKey((value) => !value)}>Use an API key instead</button>
    {showKey && <form onSubmit={(event) => { event.preventDefault(); const submitted = key; setKey(""); onApiKey(submitted); }}>
      <input type="password" autoComplete="off" spellCheck={false} aria-label="OpenAI API key" value={key} onChange={(event) => setKey(event.target.value)} placeholder="sk-…"/>
      <button className="secondary-button" disabled={busy || key.trim().length < 20}>Connect key</button>
      <small>The key is passed directly to Codex over local IPC. FPGA Studio never saves or logs it.</small>
    </form>}
    <div className="ai-auth-boundary"><ShieldCheck size={14}/><span>ChatGPT subscriptions and OpenAI API billing are separate. The selected sign-in method determines usage and policy.</span></div>
  </div>;
}

function QuestionCard({ request, busy, onSubmit }: {
  request: AiQuestionRequest;
  busy: boolean;
  onSubmit: (answers: Record<string, string[]>) => void;
}): React.JSX.Element {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const complete = request.questions.every((question) => Boolean(answers[question.id]?.trim()));
  return <article className="ai-question">
    <header><MessageSquarePlus size={15}/><div><strong>The agent needs your input</strong><span>Answer to continue this turn</span></div></header>
    {request.questions.map((question) => <fieldset key={question.id}>
      <legend><strong>{question.header}</strong><span>{question.question}</span></legend>
      {!!question.options.length && <div className="ai-question-options">{question.options.map((option) => <button className={answers[question.id] === option.label ? "active" : ""} key={option.label} onClick={() => setAnswers((current) => ({ ...current, [question.id]: option.label }))}><strong>{option.label}</strong><span>{option.description}</span></button>)}</div>}
      <input type={question.secret ? "password" : "text"} value={answers[question.id] ?? ""} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value.slice(0, 4_000) }))} placeholder={question.options.length ? "Select an option or enter another answer" : "Type your answer"}/>
    </fieldset>)}
    <button className="ai-accept" disabled={busy || !complete} onClick={() => onSubmit(Object.fromEntries(Object.entries(answers).map(([id, answer]) => [id, [answer.trim()]])))}><Send size={13}/> Continue</button>
  </article>;
}

export function AiPanel(): React.JSX.Element {
  const workbench = useWorkbench();
  const [status, setStatus] = useState<AiProviderStatus | null>(null);
  const [account, setAccount] = useState<AiAccountStatus | null>(null);
  const [models, setModels] = useState<AiModel[]>([]);
  const [modelError, setModelError] = useState<string | null>(null);
  const [conversation, setConversation] = useState<AiConversationState>(initialAiConversation);
  const [threadId, setThreadId] = useState<string | null>(() => readActiveThread(workbench.projectPath));
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [login, setLogin] = useState<AiLoginResult | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<AiSettings>(() => readAiSettings());
  const [resolving, setResolving] = useState<Array<string | number>>([]);
  const settingsRef = useRef(settings);
  const autoApprovalAttempts = useRef(new Set<string>());
  const previousProject = useRef(workbench.projectPath);
  const conversationEnd = useRef<HTMLDivElement>(null);
  const conversationRef = useRef(conversation);
  const stopWatchdog = useRef<number | null>(null);

  useEffect(() => { conversationRef.current = conversation; }, [conversation]);
  useEffect(() => () => { if (stopWatchdog.current !== null) window.clearTimeout(stopWatchdog.current); }, []);

  const setAndPersistSettings = (next: AiSettings) => {
    settingsRef.current = next;
    setSettings(next);
    writeAiSettings(next);
  };

  const refreshAccount = useCallback(async () => {
    try { setAccount(await bridge.aiAccount(false)); } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  }, []);

  const refreshThreads = useCallback(async () => {
    try { setThreads(threadSummaries(await bridge.aiThreadList())); } catch { setThreads([]); }
  }, []);

  const refreshModels = useCallback(async () => {
    try {
      setModels(modelsFromResponse(await bridge.aiModelList()));
      setModelError(null);
    } catch (caught) {
      setModelError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  const refreshChangedFiles = useCallback(async (paths: string[]) => {
    try {
      const snapshot = await bridge.openProject(workbench.root, workbench.projectPath);
      workbench.refreshProjectTree(snapshot.tree);
    } catch { /* The editor refresh below still keeps open files synchronized. */ }
    for (const path of paths) {
      const tab = useWorkbench.getState().tabs.find((value) => value.path === path);
      if (!tab || tab.content !== tab.savedContent) continue;
      try {
        const content = await bridge.readText(workbench.root, path);
        useWorkbench.getState().reloadFile(path, content);
      } catch {
        useWorkbench.getState().closeFile(path);
      }
    }
    window.dispatchEvent(new Event("fpga-studio:analysis-refresh"));
    window.dispatchEvent(new Event("fpga-studio:verification-refresh"));
    window.dispatchEvent(new Event("fpga-studio:intelligence-refresh"));
  }, [workbench.root, workbench.projectPath]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void bridge.aiProviderStatus().then(async (value) => {
      if (disposed) return;
      setStatus(value);
      if (value.connected) {
        await Promise.allSettled([refreshAccount(), refreshThreads(), refreshModels()]);
      }
    }).catch((caught) => { if (!disposed) setError(caught instanceof Error ? caught.message : String(caught)); });
    void bridge.onAiEvent((event) => {
      if (disposed) return;
      setConversation((current) => reduceAiEvent(current, event));
      if (event.method === "turn/completed" || event.method === "provider/stopped") {
        setStopping(false);
        if (stopWatchdog.current !== null) window.clearTimeout(stopWatchdog.current);
        stopWatchdog.current = null;
      }
      if (event.method === "account/updated" || event.method === "account/login/completed") {
        void refreshAccount();
        void refreshModels();
      }
      if (event.method === "account/login/completed" && event.params.success === false) {
        setError(valueString(record(event.params.error).message) ?? "OpenAI sign-in did not complete.");
      }
      if (event.method === "item/completed") {
        const paths = requestChanges(event, workbench.root);
        if (paths.length) void refreshChangedFiles(paths);
      }
      if (event.method === "provider/diagnostic") {
        const message = valueString(event.params.message);
        if (message) workbench.appendOutput({ jobId: "ai", phase: "provider", stream: "stderr", message, timestamp: event.timestamp });
      }
    }).then((stop) => { if (disposed) stop(); else unlisten = stop; });
    return () => { disposed = true; unlisten?.(); };
  }, [refreshAccount, refreshChangedFiles, refreshModels]);

  useEffect(() => { conversationEnd.current?.scrollIntoView({ block: "end" }); }, [conversation.messages, conversation.activities, conversation.approvals, conversation.questions]);

  useEffect(() => {
    if (previousProject.current === workbench.projectPath) return;
    previousProject.current = workbench.projectPath;
    void bridge.aiDisconnect().catch(() => undefined);
    setStatus(null);
    setAccount(null);
    setModels([]);
    setModelError(null);
    setThreadId(readActiveThread(workbench.projectPath));
    setConversation(initialAiConversation);
    setError(null);
    autoApprovalAttempts.current.clear();
    void bridge.aiProviderStatus().then(setStatus).catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, [workbench.projectPath]);

  const resolveApproval = useCallback(async (approval: AiApprovalRequest, decision: AiApprovalDecision) => {
    setResolving((items) => [...items, approval.requestId]);
    setError(null);
    try {
      if (decision === "alwaysAllow" && approval.method === "item/fileChange/requestApproval") {
        setAndPersistSettings({ ...settingsRef.current, alwaysAllowFileEdits: true });
      }
      if (approval.method === "item/tool/call" && decision === "allowOnce") {
        const result = await bridge.aiExecuteTangTool(approval.requestId);
        if (!result.success) setError(result.failureMessage ?? `${result.action} did not complete successfully.`);
      } else {
        const dirtyPaths = useWorkbench.getState().tabs.filter((tab) => tab.content !== tab.savedContent).map((tab) => tab.path);
        await bridge.aiRespondApproval(approval.requestId, decision === "alwaysAllow" && approval.method === "item/fileChange/requestApproval" ? "allowSession" : decision, dirtyPaths);
      }
      setConversation((current) => removeApproval(current, approval.requestId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setConversation((current) => removeApproval(current, approval.requestId));
    } finally {
      setResolving((items) => items.filter((item) => item !== approval.requestId));
    }
  }, []);

  useEffect(() => {
    if (!settings.alwaysAllowFileEdits) return;
    const approval = conversation.approvals.find((item) => item.method === "item/fileChange/requestApproval" && !resolving.includes(item.requestId));
    if (!approval) return;
    const key = String(approval.requestId);
    if (autoApprovalAttempts.current.has(key)) return;
    autoApprovalAttempts.current.add(key);
    void resolveApproval(approval, "allowOnce");
  }, [conversation.approvals, resolving, resolveApproval, settings.alwaysAllowFileEdits]);

  const answerQuestion = async (request: AiQuestionRequest, answers: Record<string, string[]>) => {
    setResolving((items) => [...items, request.requestId]);
    setError(null);
    try {
      await bridge.aiRespondUserInput(request.requestId, answers);
      setConversation((current) => removeQuestion(current, request.requestId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setResolving((items) => items.filter((item) => item !== request.requestId));
    }
  };

  const connect = async () => {
    setBusy(true); setError(null);
    try {
      const connected = await bridge.aiConnect(workbench.root, workbench.projectPath);
      setStatus(connected);
      const nextAccount = await bridge.aiAccount(false);
      setAccount(nextAccount);
      await refreshThreads();
      await refreshModels();
      const saved = readActiveThread(workbench.projectPath);
      if (saved && (nextAccount.account || !nextAccount.requiresOpenaiAuth)) {
        try {
          const response = await bridge.aiThreadResume(saved);
          setThreadId(responseThreadId(response) ?? saved);
          const history = await bridge.aiThreadRead(saved);
          setConversation(conversationWithHistory(messagesFromThread(history)));
        } catch { writeActiveThread(workbench.projectPath, null); setThreadId(null); }
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  };

  const loginChatGpt = async (deviceCode: boolean) => {
    setBusy(true); setError(null);
    try {
      const result = await bridge.aiLoginChatgpt(deviceCode);
      setLogin(result);
      const url = result.authUrl ?? result.verificationUrl;
      if (url) await bridge.aiOpenAuthUrl(url);
      if (!result.loginId) await refreshAccount();
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  };

  const loginApiKey = async (apiKey: string) => {
    setBusy(true); setError(null);
    try { setLogin(await bridge.aiLoginApiKey(apiKey)); await Promise.all([refreshAccount(), refreshModels()]); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  };

  const cancelLogin = async () => {
    if (!login?.loginId) return;
    setBusy(true); setError(null);
    try { await bridge.aiCancelLogin(login.loginId); setLogin(null); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  };

  const newConversation = () => {
    if (conversation.running) return;
    setThreadId(null);
    setConversation(initialAiConversation);
    writeActiveThread(workbench.projectPath, null);
    setHistoryOpen(false);
  };

  const openThread = async (id: string) => {
    setBusy(true); setError(null);
    try {
      await bridge.aiThreadResume(id);
      const history = await bridge.aiThreadRead(id);
      setThreadId(id);
      writeActiveThread(workbench.projectPath, id);
      setConversation(conversationWithHistory(messagesFromThread(history)));
      setHistoryOpen(false);
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  };

  const sendPrompt = async (override?: string) => {
    const text = (override ?? prompt).trim();
    if (!text || conversation.running || busy) return;
    setPrompt(""); setError(null);
    if (override === undefined) setConversation((current) => appendUserMessage(current, text));
    setBusy(true);
    try {
      let activeThread = threadId;
      if (!activeThread) {
        const response = await bridge.aiThreadStart(models.find((entry) => entry.model === settings.model)?.model);
        activeThread = responseThreadId(response);
        if (!activeThread) throw new Error("Codex did not return a conversation identifier.");
        setThreadId(activeThread);
        writeActiveThread(workbench.projectPath, activeThread);
      }
      const output = settings.includeToolOutput ? workbench.output.slice(-80).map((event) => `[${event.phase}/${event.stream}] ${event.message}`).join("\n").slice(-12_000) : undefined;
      const diagnostics = settings.includeDiagnostics ? workbench.diagnostics.slice(0, 100).map(formatDiagnostic) : [];
      const gitSummary = workbench.git?.repository
        ? [`Branch: ${workbench.git.branch ?? "unknown"}`, ...workbench.git.changes.slice(0, 100).map((change) => `${change.indexStatus}${change.worktreeStatus} ${change.path}`)].join("\n")
        : undefined;
      const response = await bridge.aiTurnStart(activeThread, text, {
        activeFile: workbench.activePath ?? undefined,
        selectedText: workbench.editorSelection || undefined,
        cursorLine: workbench.editorCursor?.line,
        cursorColumn: workbench.editorCursor?.column,
        openFiles: workbench.tabs.map((tab) => tab.path),
        diagnostics,
        terminalExcerpt: output,
        gitSummary,
      }, models.find((entry) => entry.model === settings.model)?.model,
      selectedModel?.supportedReasoningEfforts?.some((entry) => entry.reasoningEffort === settings.effort) ? settings.effort : undefined);
      const turn = record(response.turn);
      const id = valueString(turn.id);
      if (id) setConversation((current) => ({ ...current, running: true, turnId: id }));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setConversation((current) => ({ ...current, running: false, error: message }));
      setError(message);
    } finally { setBusy(false); }
  };

  const stop = async () => {
    if (!threadId || !conversation.turnId || stopping) return;
    const activeTurn = conversation.turnId;
    const forceStop = async () => {
      if (conversationRef.current.turnId !== activeTurn) return;
      try { await bridge.aiDisconnect(); } catch { /* Keep the composer recoverable. */ }
      setStatus(await bridge.aiProviderStatus().catch(() => null));
      setConversation((current) => current.turnId === activeTurn ? {
        ...current, running: false, turnId: null, approvals: [], questions: [],
        messages: current.messages.map((message) => ({ ...message, streaming: false })),
        activities: current.activities.map((activity) => activity.status === "running" ? { ...activity, status: "failed" as const } : activity),
        error: "The agent did not finish stopping. Reconnect to continue.",
      } : current);
      setStopping(false);
    };
    setStopping(true);
    try {
      await bridge.aiTurnInterrupt(threadId, activeTurn);
      if (conversationRef.current.turnId === activeTurn) {
        stopWatchdog.current = window.setTimeout(() => { void forceStop(); }, 5_000);
      } else setStopping(false);
    } catch { await forceStop(); }
  };

  const retry = () => {
    const last = [...conversation.messages].reverse().find((message) => message.role === "user");
    if (last) void sendPrompt(last.text);
  };

  const disconnect = async () => {
    if (conversation.running) return;
    setBusy(true); setError(null);
    try {
      await bridge.aiDisconnect();
      setAccount(null); setLogin(null); setConversation(initialAiConversation);
      setStatus(await bridge.aiProviderStatus());
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); setSettingsOpen(false); }
  };

  const logout = async () => {
    setBusy(true); setError(null);
    try {
      await bridge.aiLogout();
      setAccount({ account: null, requiresOpenaiAuth: true });
      newConversation();
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  };

  const signedIn = Boolean(account?.account) || account?.requiresOpenaiAuth === false;
  const selectedModel = models.find((entry) => entry.model === settings.model) ?? models.find((entry) => entry.isDefault) ?? models[0];
  const effortOptions = selectedModel?.supportedReasoningEfforts ?? [];
  const timeline = useMemo(() => {
    const messages = new Map(conversation.messages.map((message) => [message.id, message]));
    const activities = new Map(conversation.activities.map((activity) => [activity.id, activity]));
    const rows: Array<{ type: "message"; id: string; message: AiConversationState["messages"][number] } | { type: "work"; id: string; activities: AiActivityItem[] }> = [];
    for (const entry of conversation.timeline) {
      if (entry.type === "message") {
        const message = messages.get(entry.id);
        if (message) rows.push({ type: "message", id: entry.id, message });
      } else {
        const activity = activities.get(entry.id);
        if (!activity) continue;
        const previous = rows.at(-1);
        if (previous?.type === "work") previous.activities.push(activity);
        else rows.push({ type: "work", id: entry.id, activities: [activity] });
      }
    }
    return rows;
  }, [conversation.timeline, conversation.messages, conversation.activities]);

  return <aside className="ai-panel" aria-label="AI Assistant">
    <header className="ai-panel-header"><div><Bot size={17}/><strong>AI Assistant</strong><span>{status?.connected ? accountLabel(account) : "Local provider"}</span></div><nav>
      <button aria-label="New AI conversation" title="New conversation" disabled={conversation.running} onClick={newConversation}><MessageSquarePlus size={15}/></button>
      <button aria-label="AI conversation history" title="Conversation history" onClick={() => setHistoryOpen((value) => !value)}><History size={15}/></button>
      <button aria-label="AI settings" title="AI settings" onClick={() => setSettingsOpen((value) => !value)}><Settings2 size={15}/></button>
      <button aria-label="Close AI Assistant" title="Close" onClick={() => workbench.setAiPanelOpen(false)}><X size={16}/></button>
    </nav></header>

    {historyOpen && <section className="ai-popover ai-history"><header><strong>Project conversations</strong><button onClick={() => void refreshThreads()}><RefreshCw size={13}/></button></header>{threads.map((thread) => <button className={thread.id === threadId ? "active" : ""} key={thread.id} onClick={() => void openThread(thread.id)}><strong>{thread.name}</strong><span>{thread.preview || "Open conversation"}</span></button>)}{!threads.length && <p>No saved conversations for this project.</p>}</section>}

    {settingsOpen && <section className="ai-popover ai-settings"><header><strong>Agent settings</strong><button onClick={() => setSettingsOpen(false)}><X size={13}/></button></header>
      <small>Choose a model and reasoning effort beside the message box. Choices come from the connected Codex provider. A listed model can still be unavailable to an account when a turn runs.</small>
      <label className="ai-check"><input type="checkbox" checked={settings.includeDiagnostics} onChange={(event) => setAndPersistSettings({ ...settings, includeDiagnostics: event.target.checked })}/><span>Include current diagnostics</span></label>
      <label className="ai-check"><input type="checkbox" checked={settings.includeToolOutput} onChange={(event) => setAndPersistSettings({ ...settings, includeToolOutput: event.target.checked })}/><span>Include recent tool output</span></label>
      <label className="ai-check"><input type="checkbox" checked={settings.alwaysAllowFileEdits} onChange={(event) => setAndPersistSettings({ ...settings, alwaysAllowFileEdits: event.target.checked })}/><span>Always allow reviewed file edits</span></label>
      <small>Workspace boundaries and stale-file checks remain enforced even when edits are pre-approved. Commands are never globally pre-approved here.</small>
      <button className="secondary-button" disabled={busy || conversation.running} onClick={() => void disconnect()}>Disconnect local provider</button>
    </section>}

    {error && <div className="ai-error"><AlertTriangle size={15}/><span>{error}</span><button onClick={() => setError(null)}><X size={12}/></button></div>}

    {!status ? <div className="ai-loading"><LoaderCircle className="spin" size={20}/> Checking Codex…</div>
      : !status.available ? <div className="ai-unavailable"><AlertTriangle size={25}/><h3>Codex CLI required</h3><p>{status.message}</p><code>npm install -g @openai/codex</code><button className="secondary-button" onClick={() => void bridge.aiProviderStatus().then(setStatus)}>Check again</button></div>
      : !status.connected ? <div className="ai-connect"><Bot size={28}/><h3>AI for your FPGA project</h3><p>Connect the official Codex App Server to <strong>{workbench.project}</strong>. Agent access is restricted to this project and all changes remain reviewable.</p><button className="primary-button" disabled={busy} onClick={() => void connect()}>{busy ? <LoaderCircle className="spin" size={15}/> : <Play size={15}/>} Connect agent</button><small>{status.version}</small></div>
      : !signedIn ? <SignIn busy={busy} login={login} onChatGpt={() => void loginChatGpt(false)} onDeviceCode={() => void loginChatGpt(true)} onApiKey={(key) => void loginApiKey(key)} onCancelLogin={() => void cancelLogin()}/>
      : <>
        <div className="ai-model-bar">
          <label>Model<select aria-label="AI model" value={models.some((entry) => entry.model === settings.model) ? settings.model : ""} disabled={conversation.running || !models.length} onChange={(event) => setAndPersistSettings({ ...settings, model: event.target.value, effort: "" })}>
            <option value="">Account default</option>
            {models.map((entry) => <option key={entry.id} value={entry.model}>{entry.displayName}</option>)}
          </select></label>
          <label>Thinking<select aria-label="AI reasoning effort" value={effortOptions.some((entry) => entry.reasoningEffort === settings.effort) ? settings.effort : ""} disabled={conversation.running || !effortOptions.length} onChange={(event) => setAndPersistSettings({ ...settings, effort: event.target.value })}>
            <option value="">Default</option>
            {effortOptions.map((entry) => <option key={entry.reasoningEffort} value={entry.reasoningEffort}>{entry.reasoningEffort}</option>)}
          </select></label>
          <button aria-label="Refresh AI models" title="Refresh models" onClick={() => void refreshModels()}><RefreshCw size={13}/></button>
        </div>
        {modelError && <div className="ai-model-error">Model list unavailable: {modelError}</div>}
        <div className="ai-conversation">
          {!conversation.messages.length && <div className="ai-empty"><Code2 size={25}/><h3>What should we build?</h3><p>Ask about RTL, diagnose synthesis errors, propose a patch, or run an approved FPGA workflow.</p><div>{["Explain the active module", "Find and fix synthesis errors", "Review timing and suggest improvements"].map((value) => <button key={value} onClick={() => setPrompt(value)}>{value}</button>)}</div></div>}
          {timeline.map((row) => row.type === "message"
            ? <article className={`ai-message ${row.message.role}`} key={row.id}><header>{row.message.role === "user" ? <UserRound size={13}/> : <Bot size={13}/>}<strong>{row.message.role === "user" ? "You" : "Codex"}</strong>{row.message.streaming && <LoaderCircle className="spin" size={11}/>}</header><MarkdownMessage text={row.message.text} onOpenFile={(path, line, column) => void openWorkspaceLocation(path, line, column)}/></article>
            : <ActivityGroup activities={row.activities} key={row.id}/>)}
          {conversation.approvals.map((approval) => <ApprovalCard key={String(approval.requestId)} approval={approval} busy={resolving.includes(approval.requestId)} onDecision={(decision) => void resolveApproval(approval, decision)}/>)}
          {conversation.questions.map((question) => <QuestionCard key={String(question.requestId)} request={question} busy={resolving.includes(question.requestId)} onSubmit={(answers) => void answerQuestion(question, answers)}/>)}
          {(conversation.error || error) && <div className="ai-retry"><AlertTriangle size={14}/><span>{conversation.error ?? error}</span><button onClick={retry}><RotateCcw size={12}/> Retry</button></div>}
          <div ref={conversationEnd}/>
        </div>
        <div className="ai-composer">
          <textarea aria-label="Ask AI about this project" value={prompt} disabled={conversation.running} onChange={(event) => setPrompt(event.target.value.slice(0, 100_000))} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendPrompt(); } }} placeholder="Ask AI about this FPGA project…"/>
          <div><span>{workbench.activePath ? `${workbench.activePath}${workbench.editorSelection ? " · selection" : ""}` : "Project context"}</span>{conversation.running ? <button className="ai-stop" disabled={stopping} onClick={() => void stop()}>{stopping ? <LoaderCircle className="spin" size={14}/> : <CircleStop size={14}/>} {stopping ? "Stopping…" : "Stop"}</button> : <button className="ai-send" disabled={!prompt.trim() || busy} onClick={() => void sendPrompt()}><Send size={14}/> Send</button>}</div>
        </div>
        <footer className="ai-footer"><ShieldCheck size={12}/><span>Project sandbox · approval-gated edits</span><button title="Sign out" disabled={busy || conversation.running} onClick={() => void logout()}><LogOut size={12}/></button></footer>
      </>}
  </aside>;
}
