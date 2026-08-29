import { useEffect, useRef, useState } from "react";
import Editor, { type BeforeMount, type Monaco, type OnMount } from "@monaco-editor/react";
import { CircleX, Code2, GitCompareArrows, X } from "lucide-react";
import { bridge } from "../lib/bridge";
import {
  completionCandidates,
  definitionFor,
  emptyHdlIndex,
  hdlKeywords,
  moduleAtPosition,
  referencesFor,
  symbolsFromBuffer,
  type CompletionCandidate,
} from "../lib/hdl-intelligence";
import { fileName, languageForPath } from "../lib/language";
import "../lib/monaco-loader";
import { useWorkbench } from "../store/workbench";
import type { HdlIndex } from "../types";

type MonacoModel = import("monaco-editor").editor.ITextModel;
type MonacoPosition = import("monaco-editor").Position;
type MonacoEditor = import("monaco-editor").editor.IStandaloneCodeEditor;

let liveIndex: HdlIndex = emptyHdlIndex();
let liveRoot = "";
let monacoApi: Monaco | null = null;
let languageServicesConfigured = false;

function candidateKind(monaco: Monaco, candidate: CompletionCandidate): number {
  if (candidate.kind === "keyword") return monaco.languages.CompletionItemKind.Keyword;
  if (candidate.kind === "module") return monaco.languages.CompletionItemKind.Module;
  if (candidate.kind === "port") return monaco.languages.CompletionItemKind.Interface;
  if (candidate.kind === "parameter") return monaco.languages.CompletionItemKind.Constant;
  if (candidate.kind === "file") return monaco.languages.CompletionItemKind.File;
  if (candidate.kind === "snippet") return monaco.languages.CompletionItemKind.Snippet;
  return monaco.languages.CompletionItemKind.Variable;
}

function applyHdlMarkers(): void {
  if (!monacoApi) return;
  for (const model of monacoApi.editor.getModels()) {
    const path = model.uri.path.replace(/^\//, "");
    const markers = liveIndex.diagnostics
      .filter((item) => item.file && (path.endsWith(item.file) || item.file.endsWith(path)))
      .map((item) => ({
        severity: item.severity === "error" ? monacoApi!.MarkerSeverity.Error : item.severity === "warning" ? monacoApi!.MarkerSeverity.Warning : monacoApi!.MarkerSeverity.Info,
        message: item.suggestion ? `${item.message}\n${item.suggestion}` : item.message,
        source: item.source,
        code: item.code,
        startLineNumber: item.line ?? 1,
        startColumn: item.column ?? 1,
        endLineNumber: item.line ?? 1,
        endColumn: (item.column ?? 1) + 1,
      }));
    monacoApi.editor.setModelMarkers(model, "fpga-studio", markers);
  }
}

function fileModel(monaco: Monaco, file: string): Promise<MonacoModel | null> {
  const normalized = file.replaceAll("\\", "/").replace(/^\//, "");
  const existing = monaco.editor.getModels().find((model: MonacoModel) => model.uri.path.replace(/^\//, "").endsWith(normalized));
  if (existing) return Promise.resolve(existing);
  if (!liveRoot) return Promise.resolve(null);
  return bridge.readText(liveRoot, normalized).then((content) => {
    const uri = monaco.Uri.parse(`file:///${normalized}`);
    return monaco.editor.getModel(uri) ?? monaco.editor.createModel(content, languageForPath(normalized), uri);
  }).catch(() => null);
}

const configureMonaco: BeforeMount = (monaco) => {
  monacoApi = monaco;
  for (const id of ["verilog", "systemverilog"]) {
    if (!monaco.languages.getLanguages().some((language: { id: string }) => language.id === id)) monaco.languages.register({ id });
    monaco.languages.setMonarchTokensProvider(id, {
      keywords: [...hdlKeywords],
      tokenizer: {
        root: [[/\/\/.*$/, "comment"], [/\/\*/, "comment", "@comment"], [/[a-zA-Z_$][\w$]*/, { cases: { "@keywords": "keyword", "@default": "identifier" } }], [/\d+'[bdho][0-9a-fA-F_xzXZ]+/, "number"], [/\d+/, "number"], [/".*?"/, "string"], [/[{}()[\]]/, "@brackets"], [/[;,.]/, "delimiter"]],
        comment: [[/[^/*]+/, "comment"], [/\*\//, "comment", "@pop"], [/[/*]/, "comment"]],
      },
    });
    monaco.languages.setLanguageConfiguration(id, {
      comments: { lineComment: "//", blockComment: ["/*", "*/"] },
      brackets: [["{", "}"], ["[", "]"], ["(", ")"]],
      autoClosingPairs: [{ open: "(", close: ")" }, { open: "[", close: "]" }, { open: "{", close: "}" }, { open: "\"", close: "\"" }],
      surroundingPairs: [{ open: "(", close: ")" }, { open: "[", close: "]" }, { open: "{", close: "}" }, { open: "\"", close: "\"" }],
      indentationRules: {
        increaseIndentPattern: /^((?!\/\/).)*(\bbegin\b|\bcase[xz]?\b|\bgenerate\b|\bmodule\b).*$/,
        decreaseIndentPattern: /^\s*(end|endcase|endgenerate|endmodule)\b/,
      },
      folding: { markers: { start: /^\s*\/\/\s*#?region\b/, end: /^\s*\/\/\s*#?endregion\b/ } },
    });
  }
  if (languageServicesConfigured) return;
  languageServicesConfigured = true;
  for (const id of ["verilog", "systemverilog"]) {
    monaco.languages.registerCompletionItemProvider(id, {
      triggerCharacters: [".", "`", "\""],
      provideCompletionItems(model: MonacoModel, position: MonacoPosition) {
        const word = model.getWordUntilPosition(position);
        const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
        const file = model.uri.path.replace(/^\//, "");
        const currentSymbols = symbolsFromBuffer(model.getValue(), file);
        const index = { ...liveIndex, symbols: [...liveIndex.symbols.filter((symbol) => !file.endsWith(symbol.file)), ...currentSymbols] };
        const candidates = completionCandidates(index, model.getValue(), model.getOffsetAt(position));
        return { suggestions: candidates.map((candidate) => ({
          label: candidate.label,
          kind: candidateKind(monaco, candidate),
          insertText: candidate.insertText,
          detail: candidate.detail,
          documentation: candidate.kind === "file" ? "Project-local HDL resource" : undefined,
          insertTextRules: candidate.snippet ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
          range,
        })) };
      },
    });
    monaco.languages.registerHoverProvider(id, {
      provideHover(model: MonacoModel, position: MonacoPosition) {
        const word = model.getWordAtPosition(position)?.word;
        if (!word) return null;
        const file = model.uri.path.replace(/^\//, "");
        const symbol = symbolsFromBuffer(model.getValue(), file).find((item) => item.name === word)
          ?? definitionFor(liveIndex, word, file);
        if (!symbol) return null;
        return {
          range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column + word.length),
          contents: [{ value: `**${symbol.kind}** \`${symbol.name}\`` }, { value: `${symbol.detail}  \n${symbol.file}:${symbol.line}` }],
        };
      },
    });
    monaco.languages.registerDefinitionProvider(id, {
      async provideDefinition(model: MonacoModel, position: MonacoPosition) {
        const word = model.getWordAtPosition(position)?.word;
        const symbol = word ? definitionFor(liveIndex, word, model.uri.path.replace(/^\//, "")) : undefined;
        if (!symbol) return null;
        const target = await fileModel(monaco, symbol.file);
        return target ? { uri: target.uri, range: new monaco.Range(symbol.line, symbol.column, symbol.line, symbol.column + symbol.name.length) } : null;
      },
    });
    monaco.languages.registerReferenceProvider(id, {
      async provideReferences(model: MonacoModel, position: MonacoPosition) {
        const word = model.getWordAtPosition(position)?.word;
        if (!word) return [];
        const locations = await Promise.all(referencesFor(liveIndex, word).map(async (reference) => {
          const target = await fileModel(monaco, reference.file);
          return target ? { uri: target.uri, range: new monaco.Range(reference.line, reference.column, reference.line, reference.column + word.length) } : null;
        }));
        return locations.filter((location): location is NonNullable<typeof location> => Boolean(location));
      },
    });
    monaco.languages.registerSignatureHelpProvider(id, {
      signatureHelpTriggerCharacters: ["(", ",", "."],
      provideSignatureHelp(model: MonacoModel, position: MonacoPosition) {
        const prefix = model.getValue().slice(0, model.getOffsetAt(position));
        const module = moduleAtPosition(prefix, liveIndex.modules);
        if (!module) return null;
        const label = `${module.name} (${module.portDetails.map((port) => `${port.direction} ${port.dataType} ${port.name}`).join(", ")})`;
        return {
          value: {
            signatures: [{ label, documentation: `Interface declared at ${module.file}:${module.line}`, parameters: module.portDetails.map((port) => ({ label: port.name, documentation: `${port.direction} ${port.dataType}` })) }],
            activeSignature: 0,
            activeParameter: 0,
          },
          dispose: () => undefined,
        };
      },
    });
    monaco.languages.registerDocumentSymbolProvider(id, {
      provideDocumentSymbols(model: MonacoModel) {
        return symbolsFromBuffer(model.getValue(), model.uri.path.replace(/^\//, "")).map((symbol) => {
          const range = new monaco.Range(symbol.line, symbol.column, symbol.line, symbol.column + symbol.name.length);
          return { name: symbol.name, detail: symbol.kind, kind: symbol.kind === "module" ? monaco.languages.SymbolKind.Module : monaco.languages.SymbolKind.Variable, tags: [], range, selectionRange: range };
        });
      },
    });
  }
};

export function EditorWorkspace(): React.JSX.Element {
  const {
    root, projectPath, tabs, activePath, theme, updateFile, closeFile, openFile, setDiagnostics,
    setHdlIndex, navigation, clearNavigation, navigateTo,
  } = useWorkbench();
  const [index, setIndex] = useState<HdlIndex>(liveIndex);
  const editorRef = useRef<MonacoEditor | null>(null);
  const active = tabs.find((tab) => tab.path === activePath);
  const savedRevision = tabs.map((tab) => `${tab.path}:${tab.savedContent}`).join("\u0000");

  useEffect(() => {
    let disposed = false;
    liveRoot = root;
    setHdlIndex(null, "indexing");
    const timer = window.setTimeout(() => {
      void bridge.hdlIndex(root, projectPath).then((value) => {
        if (disposed) return;
        liveIndex = value;
        setIndex(value);
        setHdlIndex(value, "ready");
        const existing = useWorkbench.getState().diagnostics.filter((item) => item.source !== "hdl-intelligence");
        setDiagnostics([...existing, ...value.diagnostics]);
        applyHdlMarkers();
      }).catch(() => { if (!disposed) setHdlIndex(null, "degraded"); });
    }, 180);
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [root, projectPath, savedRevision, setDiagnostics, setHdlIndex]);

  useEffect(() => {
    if (!navigation || navigation.path !== activePath || !editorRef.current) return;
    const position = { lineNumber: Math.max(1, navigation.line), column: Math.max(1, navigation.column) };
    editorRef.current.setPosition(position);
    editorRef.current.revealPositionInCenter(position);
    editorRef.current.focus();
    clearNavigation();
  }, [navigation, activePath, clearNavigation]);

  const openSymbol = async (editor: MonacoEditor) => {
    const position = editor.getPosition();
    const model = editor.getModel();
    const word = position && model ? model.getWordAtPosition(position)?.word : undefined;
    const local = model && word ? symbolsFromBuffer(model.getValue(), activePath ?? "").find((symbol) => symbol.name === word) : undefined;
    const symbol = local ?? (word ? definitionFor(liveIndex, word, activePath ?? undefined) : undefined);
    if (!symbol) return;
    const path = symbol.file.replaceAll("\\", "/");
    const content = path === activePath && model ? model.getValue() : await bridge.readText(root, path);
    openFile({ path, name: fileName(path), language: languageForPath(path), content, savedContent: content });
    navigateTo(path, symbol.line, symbol.column);
  };

  const mounted: OnMount = (editor, monaco) => {
    monacoApi = monaco;
    editorRef.current = editor;
    editor.addCommand(monaco.KeyCode.F12, () => void openSymbol(editor));
    applyHdlMarkers();
  };

  return (
    <section className="editor-workspace">
      <div className="editor-tabs" role="tablist">
        {tabs.map((tab) => <button role="tab" aria-selected={tab.path === activePath} className={tab.path === activePath ? "active" : ""} key={tab.path} onClick={() => openFile(tab)}><Code2 size={14}/><span>{tab.name}</span>{tab.content !== tab.savedContent && <span className="dirty-dot" title="Unsaved"/>}<X size={13} onClick={(event) => { event.stopPropagation(); closeFile(tab.path); }}/></button>)}
      </div>
      {active ? <>
        <div className="breadcrumbs"><span>{active.path.replaceAll("/", "  ›  ")}</span><span className="breadcrumb-symbol">◇ {index.top} · {index.symbols.length} symbols · F12 definition · Shift+F12 references</span></div>
        <div className="editor-area">
          <Editor beforeMount={configureMonaco} onMount={mounted} path={active.path} language={active.language} value={active.content} theme={theme === "light" ? "light" : "vs-dark"} onChange={(value) => updateFile(active.path, value ?? "")} options={{ fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace", fontSize: 13, lineHeight: 21, minimap: { enabled: true, scale: 1 }, smoothScrolling: true, cursorSmoothCaretAnimation: "on", renderWhitespace: "selection", bracketPairColorization: { enabled: true }, guides: { bracketPairs: true, indentation: true }, padding: { top: 12 }, automaticLayout: true, formatOnPaste: true, scrollBeyondLastLine: false, wordWrap: "off", quickSuggestions: { other: true, comments: false, strings: false }, suggestOnTriggerCharacters: true, folding: true, multiCursorModifier: "alt" }}/>
        </div>
      </> : <div className="empty-editor"><CircleX size={30}/><h2>No source file open</h2><p>Select a file from Explorer or create a module.</p><button className="secondary-button"><GitCompareArrows size={15}/> Open recent source</button></div>}
    </section>
  );
}
