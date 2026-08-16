import { useEffect, useState } from "react";
import Editor, { type BeforeMount, type Monaco, type OnMount } from "@monaco-editor/react";
import { CircleX, Code2, GitCompareArrows, X } from "lucide-react";
import { bridge } from "../lib/bridge";
import { useWorkbench } from "../store/workbench";
import type { HdlIndex, HdlSymbol } from "../types";

type MonacoModel = import("monaco-editor").editor.ITextModel;
type MonacoPosition = import("monaco-editor").Position;

let liveIndex: HdlIndex = { top: "top", files: [], symbols: [], diagnostics: [], modules: [], instances: [], clockDomains: [], signals: [] };
let monacoApi: Monaco | null = null;
let languageServicesConfigured = false;

const hdlKeywords = ["always_comb", "always_ff", "always_latch", "assign", "begin", "case", "default", "else", "end", "endcase", "endgenerate", "endmodule", "for", "function", "generate", "genvar", "if", "initial", "inout", "input", "integer", "localparam", "logic", "module", "negedge", "output", "parameter", "posedge", "reg", "repeat", "signed", "task", "typedef", "unique", "unsigned", "wire"];

function monacoKind(monaco: Monaco, symbol: HdlSymbol): number {
  if (symbol.kind === "module") return monaco.languages.CompletionItemKind.Module;
  if (symbol.kind === "instance") return monaco.languages.CompletionItemKind.Reference;
  if (["input", "output", "inout"].includes(symbol.kind)) return monaco.languages.CompletionItemKind.Interface;
  if (["parameter", "localparam"].includes(symbol.kind)) return monaco.languages.CompletionItemKind.Constant;
  return monaco.languages.CompletionItemKind.Variable;
}

function applyHdlMarkers(): void {
  if (!monacoApi) return;
  for (const model of monacoApi.editor.getModels()) {
    const path = model.uri.path.replace(/^\//, "");
    const markers = liveIndex.diagnostics
      .filter((item) => item.file && (path.endsWith(item.file) || item.file.endsWith(path)))
      .map((item) => ({
        severity: item.severity === "error" ? monacoApi!.MarkerSeverity.Error : monacoApi!.MarkerSeverity.Warning,
        message: item.message,
        source: item.source,
        startLineNumber: item.line ?? 1,
        startColumn: item.column ?? 1,
        endLineNumber: item.line ?? 1,
        endColumn: (item.column ?? 1) + 1,
      }));
    monacoApi.editor.setModelMarkers(model, "fpga-studio", markers);
  }
}

const configureMonaco: BeforeMount = (monaco) => {
  monacoApi = monaco;
  for (const id of ["verilog", "systemverilog"]) {
    if (!monaco.languages.getLanguages().some((language: { id: string }) => language.id === id)) monaco.languages.register({ id });
    monaco.languages.setMonarchTokensProvider(id, {
      keywords: hdlKeywords,
      tokenizer: { root: [[/\/\/.*$/, "comment"], [/\/\*/, "comment", "@comment"], [/[a-zA-Z_$][\w$]*/, { cases: { "@keywords": "keyword", "@default": "identifier" } }], [/\d+'[bdho][0-9a-fA-F_xzXZ]+/, "number"], [/\d+/, "number"], [/".*?"/, "string"], [/[{}()[\]]/, "@brackets"], [/[;,.]/, "delimiter"]], comment: [[/[^/*]+/, "comment"], [/\*\//, "comment", "@pop"], [/[/*]/, "comment"]] },
    });
    monaco.languages.setLanguageConfiguration(id, { comments: { lineComment: "//", blockComment: ["/*", "*/"] }, brackets: [["{", "}"], ["[", "]"], ["(", ")"]], autoClosingPairs: [{ open: "(", close: ")" }, { open: "[", close: "]" }, { open: "begin", close: "end" }, { open: "\"", close: "\"" }] });
  }
  if (languageServicesConfigured) return;
  languageServicesConfigured = true;
  for (const id of ["verilog", "systemverilog"]) {
    monaco.languages.registerCompletionItemProvider(id, {
      triggerCharacters: [".", "`"],
      provideCompletionItems(model: MonacoModel, position: MonacoPosition) {
        const word = model.getWordUntilPosition(position);
        const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
        const seen = new Set<string>();
        const symbols = liveIndex.symbols.filter((symbol) => { if (seen.has(symbol.name)) return false; seen.add(symbol.name); return true; });
        return { suggestions: [
          ...hdlKeywords.map((keyword) => ({ label: keyword, kind: monaco.languages.CompletionItemKind.Keyword, insertText: keyword, range })),
          ...symbols.map((symbol) => ({ label: symbol.name, kind: monacoKind(monaco, symbol), insertText: symbol.name, detail: `${symbol.detail} — ${symbol.file}:${symbol.line}`, documentation: `Project-local ${symbol.kind}`, range })),
          { label: "module template", kind: monaco.languages.CompletionItemKind.Snippet, detail: "Create a synthesizable SystemVerilog module", insertText: "module ${1:name} (\n    input  logic clk,\n    input  logic reset,\n    output logic ${2:result}\n);\n    ${0}\nendmodule", insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range },
          { label: "always_ff register", kind: monaco.languages.CompletionItemKind.Snippet, insertText: "always_ff @(posedge clk) begin\n    if (reset) begin\n        ${1:value} <= '0;\n    end else begin\n        ${1:value} <= ${2:next_value};\n    end\nend", insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range },
        ] };
      },
    });
    monaco.languages.registerHoverProvider(id, {
      provideHover(model: MonacoModel, position: MonacoPosition) {
        const word = model.getWordAtPosition(position)?.word;
        if (!word) return null;
        const symbol = liveIndex.symbols.find((item) => item.name === word);
        return symbol ? { range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column + word.length), contents: [{ value: `**${symbol.kind}** \`${symbol.name}\`` }, { value: `${symbol.detail}  \n${symbol.file}:${symbol.line}` }] } : null;
      },
    });
    monaco.languages.registerDefinitionProvider(id, {
      provideDefinition(model: MonacoModel, position: MonacoPosition) {
        const word = model.getWordAtPosition(position)?.word;
        const symbol = liveIndex.symbols.find((item) => item.name === word);
        if (!symbol) return null;
        const target = monaco.editor.getModels().find((candidate: MonacoModel) => candidate.uri.path.replace(/^\//, "").endsWith(symbol.file));
        return target ? { uri: target.uri, range: new monaco.Range(symbol.line, symbol.column, symbol.line, symbol.column + symbol.name.length) } : null;
      },
    });
    monaco.languages.registerDocumentSymbolProvider(id, {
      provideDocumentSymbols(model: MonacoModel) {
        const values = new Array<import("monaco-editor").languages.DocumentSymbol>();
        const matcher = /^\s*(module|input|output|inout|logic|wire|reg|parameter|localparam)\s+(?:logic\s+|wire\s+|reg\s+|signed\s+|unsigned\s+|\[[^\]]+\]\s*)*([A-Za-z_]\w*)/;
        for (let line = 1; line <= model.getLineCount(); line += 1) {
          const match = matcher.exec(model.getLineContent(line));
          if (!match?.[2]) continue;
          const start = model.getLineContent(line).indexOf(match[2]) + 1;
          const range = new monaco.Range(line, start, line, start + match[2].length);
          values.push({ name: match[2], detail: match[1] ?? "symbol", kind: match[1] === "module" ? monaco.languages.SymbolKind.Module : monaco.languages.SymbolKind.Variable, tags: [], range, selectionRange: range });
        }
        return values;
      },
    });
  }
};

export function EditorWorkspace(): React.JSX.Element {
  const { root, projectPath, tabs, activePath, theme, updateFile, closeFile, openFile, setDiagnostics } = useWorkbench();
  const [index, setIndex] = useState<HdlIndex>(liveIndex);
  const active = tabs.find((tab) => tab.path === activePath);
  const savedRevision = tabs.map((tab) => `${tab.path}:${tab.savedContent}`).join("\u0000");
  useEffect(() => {
    let disposed = false;
    const timer = window.setTimeout(() => {
      void bridge.hdlIndex(root, projectPath).then((value) => {
        if (disposed) return;
        liveIndex = value;
        setIndex(value);
        const existing = useWorkbench.getState().diagnostics.filter((item) => item.source !== "hdl-intelligence");
        setDiagnostics([...existing, ...value.diagnostics]);
        applyHdlMarkers();
      }).catch(() => undefined);
    }, 180);
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [root, projectPath, savedRevision, setDiagnostics]);
  const mounted: OnMount = (_editor, monaco) => { monacoApi = monaco; applyHdlMarkers(); };
  return (
    <section className="editor-workspace">
      <div className="editor-tabs" role="tablist">
        {tabs.map((tab) => <button role="tab" aria-selected={tab.path === activePath} className={tab.path === activePath ? "active" : ""} key={tab.path} onClick={() => openFile(tab)}><Code2 size={14} /><span>{tab.name}</span>{tab.content !== tab.savedContent && <span className="dirty-dot" title="Unsaved" />}<X size={13} onClick={(event) => { event.stopPropagation(); closeFile(tab.path); }} /></button>)}
      </div>
      {active ? <>
        <div className="breadcrumbs"><span>{active.path.replaceAll("/", "  ›  ")}</span><span className="breadcrumb-symbol">◇ {index.top} · {index.symbols.length} symbols</span></div>
        <div className="editor-area">
          <Editor beforeMount={configureMonaco} onMount={mounted} path={active.path} language={active.language} value={active.content} theme={theme === "light" ? "light" : "vs-dark"} onChange={(value) => updateFile(active.path, value ?? "")} options={{ fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace", fontSize: 13, lineHeight: 21, minimap: { enabled: true, scale: 1 }, smoothScrolling: true, cursorSmoothCaretAnimation: "on", renderWhitespace: "selection", bracketPairColorization: { enabled: true }, guides: { bracketPairs: true, indentation: true }, padding: { top: 12 }, automaticLayout: true, formatOnPaste: true, scrollBeyondLastLine: false, wordWrap: "off", quickSuggestions: { other: true, comments: false, strings: false }, suggestOnTriggerCharacters: true }} />
        </div>
      </> : <div className="empty-editor"><CircleX size={30} /><h2>No source file open</h2><p>Select a file from Explorer or create a module.</p><button className="secondary-button"><GitCompareArrows size={15} /> Open recent source</button></div>}
    </section>
  );
}
