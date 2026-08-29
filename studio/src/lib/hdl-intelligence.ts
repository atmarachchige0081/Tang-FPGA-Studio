import type { FpgaTarget, HdlIndex, HdlModule, HdlReference, HdlSymbol } from "../types";

export const hdlKeywords = [
  "always_comb", "always_ff", "always_latch", "assign", "begin", "case", "default", "else",
  "end", "endcase", "endfunction", "endgenerate", "endmodule", "endpackage", "endtask", "enum",
  "for", "function", "generate", "genvar", "if", "import", "initial", "inout", "input", "integer",
  "interface", "localparam", "logic", "module", "negedge", "output", "package", "parameter", "posedge",
  "reg", "repeat", "signed", "struct", "task", "typedef", "unique", "unsigned", "wire",
] as const;

export const emptyHdlIndex = (): HdlIndex => ({
  top: "top", files: [], symbols: [], references: [], diagnostics: [], modules: [], instances: [],
  clockDomains: [], signals: [],
});

export interface CompletionCandidate {
  label: string;
  kind: "keyword" | "module" | "port" | "signal" | "parameter" | "file" | "symbol" | "snippet";
  detail: string;
  insertText: string;
  snippet?: boolean;
}

export interface SymbolLocation {
  file: string;
  line: number;
  column: number;
}

function targetPackage(device: string): { package: string; speedGrade: string } {
  const match = /(?:PG|QN|UG|BG|CS|FN)\d+[A-Z]?/.exec(device);
  return match
    ? { package: match[0], speedGrade: device.slice((match.index ?? 0) + match[0].length) }
    : { package: "registered-board-package", speedGrade: "profile-defined" };
}

export function fpgaTargetFromBoard(board: { vendor: string; family: string; device: string }): FpgaTarget {
  return { vendor: board.vendor, family: board.family, device: board.device, ...targetPackage(board.device) };
}

function unique(candidates: CompletionCandidate[]): CompletionCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.kind}:${candidate.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function moduleAtPosition(prefix: string, modules: HdlModule[]): HdlModule | undefined {
  const tail = prefix.slice(Math.max(0, prefix.length - 8_192));
  return modules.find((module) => {
    const escaped = module.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\s*(?:#\\s*\\([^;]*?\\)\\s*)?[A-Za-z_]\\w*\\s*\\([^;]*$`, "s").test(tail);
  });
}

function symbolKind(symbol: HdlSymbol): CompletionCandidate["kind"] {
  if (symbol.kind === "module") return "module";
  if (["parameter", "localparam"].includes(symbol.kind)) return "parameter";
  if (["input", "output", "inout", "logic", "wire", "reg"].includes(symbol.kind)) return "signal";
  return "symbol";
}

export function completionCandidates(
  index: HdlIndex,
  content: string,
  offset: number,
): CompletionCandidate[] {
  const prefix = content.slice(0, Math.max(0, offset));
  const include = /`include\s+"([^"]*)$/.exec(prefix.slice(-512));
  if (include) {
    return index.files
      .filter((file) => /\.(?:vh|svh|v|sv)$/i.test(file))
      .map((file) => ({ label: file, kind: "file", detail: "Project HDL source", insertText: file }));
  }

  const instantiated = moduleAtPosition(prefix, index.modules);
  if (instantiated) {
    return instantiated.portDetails.map((port) => ({
      label: port.name,
      kind: "port",
      detail: `${port.direction} ${port.dataType} · ${instantiated.name}`,
      insertText: `.${port.name} (\${1:${port.name}})`,
      snippet: true,
    }));
  }

  if (/\bmodule\s+[A-Za-z_]\w*(?:\s*#\s*\([^;]*\))?\s*\([^;]*$/s.test(prefix.slice(-4_096))) {
    return [
      { label: "input logic", kind: "snippet", detail: "Declare an input port", insertText: "input  logic \${1:signal}", snippet: true },
      { label: "output logic", kind: "snippet", detail: "Declare an output port", insertText: "output logic \${1:signal}", snippet: true },
      { label: "inout wire", kind: "snippet", detail: "Declare a bidirectional port", insertText: "inout  wire  \${1:signal}", snippet: true },
    ];
  }

  const inProceduralBlock = /\balways_(?:ff|comb|latch)\b[^;]*$/s.test(prefix.slice(-4_096));
  const symbols = index.symbols
    .filter((symbol) => inProceduralBlock ? symbolKind(symbol) !== "module" : true)
    .map((symbol) => ({
      label: symbol.name,
      kind: symbolKind(symbol),
      detail: `${symbol.detail} · ${symbol.file}:${symbol.line}`,
      insertText: symbol.name,
    } satisfies CompletionCandidate));
  const keywords = hdlKeywords
    .filter((keyword) => !inProceduralBlock || !["module", "package", "interface"].includes(keyword))
    .map((keyword) => ({ label: keyword, kind: "keyword" as const, detail: "SystemVerilog keyword", insertText: keyword }));
  return unique([...symbols, ...keywords]);
}

export function symbolsFromBuffer(content: string, file: string): HdlSymbol[] {
  const declaration = /^\s*(module|input|output|inout|logic|wire|reg|parameter|localparam|function|task|package|typedef)\b(?:\s+(?:logic|wire|reg|signed|unsigned|integer|automatic|enum|struct))*\s+([A-Za-z_]\w*)/;
  const symbols: HdlSymbol[] = [];
  content.split(/\r?\n/).forEach((line, index) => {
    const match = declaration.exec(line);
    if (!match?.[1] || !match[2]) return;
    symbols.push({
      name: match[2], kind: match[1], file, line: index + 1,
      column: Math.max(1, line.indexOf(match[2]) + 1), detail: `${match[1]} declaration (current buffer)`,
    });
  });
  return symbols;
}

export function definitionFor(index: HdlIndex, name: string, currentFile?: string): HdlSymbol | undefined {
  const candidates = index.symbols.filter((symbol) => symbol.name === name);
  return candidates.find((symbol) => symbol.file === currentFile && symbol.kind !== "instance")
    ?? candidates.find((symbol) => symbol.kind === "module")
    ?? candidates.find((symbol) => symbol.kind !== "instance");
}

export function referencesFor(index: HdlIndex, name: string): HdlReference[] {
  return index.references.filter((reference) => reference.name === name);
}

export function searchableSymbols(index: HdlIndex, query: string): HdlSymbol[] {
  const normalized = query.trim().toLowerCase();
  return index.symbols
    .filter((symbol) => !normalized || `${symbol.name} ${symbol.kind} ${symbol.detail}`.toLowerCase().includes(normalized))
    .slice(0, 500);
}
