import type { ReactNode } from "react";

interface Props {
  text: string;
  onOpenFile: (path: string, line: number, column: number) => void;
}

const fileReference = /((?:[A-Za-z0-9_.-]+[\\/])*[A-Za-z0-9_.-]+\.(?:sv|v|svh|vh|cst|sdc|json|md|ps1|psd1|tcl)):(\d+)(?::(\d+))?/;
const inlineToken = /(\*\*([^*]+)\*\*|(?<!\*)\*([^*\n]+)\*(?!\*)|`([^`\n]+)`|\[([^\]]+)\]\((?:<([^>]+)>|([^)]+))\)|((?:[A-Za-z0-9_.-]+[\\/])*[A-Za-z0-9_.-]+\.(?:sv|v|svh|vh|cst|sdc|json|md|ps1|psd1|tcl)):(\d+)(?::(\d+))?)/g;
const codeToken = /(\/\/.*$|\b(?:module|endmodule|input|output|inout|logic|wire|reg|always_ff|always_comb|assign|begin|end|if|else|case|endcase|parameter|localparam|posedge|negedge|generate|endgenerate|function|endfunction|task|endtask)\b|\b\d+(?:'[bdho][0-9a-f_xz]+)?\b|"[^"\n]*")/gim;

function inlineNodes(text: string, onOpenFile: Props["onOpenFile"]): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(inlineToken)) {
    const index = match.index ?? 0;
    if (index > cursor) nodes.push(text.slice(cursor, index));
    const key = `${index}-${nodes.length}`;
    if (match[2]) nodes.push(<strong key={key}>{inlineNodes(match[2], onOpenFile)}</strong>);
    else if (match[3]) nodes.push(<em key={key}>{inlineNodes(match[3], onOpenFile)}</em>);
    else if (match[4]) nodes.push(<code className="ai-inline-code" key={key}>{match[4]}</code>);
    else {
      const label = match[5];
      const reference = label ? fileReference.exec(label) ?? fileReference.exec(match[6] ?? match[7] ?? "") : fileReference.exec(match[0]);
      if (reference) {
        const path = reference[1]!.replaceAll("\\", "/");
        nodes.push(<button className="ai-file-reference" key={key} onClick={() => onOpenFile(path, Number(reference[2]), Number(reference[3] ?? 1))}>{label ?? match[0]}</button>);
      } else nodes.push(label ?? match[0]);
    }
    cursor = index + match[0].length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function highlightedCode(code: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const match of code.matchAll(codeToken)) {
    const index = match.index ?? 0;
    if (index > cursor) nodes.push(code.slice(cursor, index));
    const token = match[0];
    const className = token.startsWith("//") ? "comment" : token.startsWith('"') ? "string" : /^\d/.test(token) ? "number" : "keyword";
    nodes.push(<span className={`ai-code-${className}`} key={`${index}-${token}`}>{token}</span>);
    cursor = index + token.length;
  }
  if (cursor < code.length) nodes.push(code.slice(cursor));
  return nodes;
}

function isBlockStart(line: string): boolean {
  return /^\s*(```|#{1,4} |[-*] |\d+\. |>)\s?/.test(line);
}

export function MarkdownMessage({ text, onOpenFile }: Props): React.JSX.Element {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  const blocks: ReactNode[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index]!;
    if (!line.trim()) { index++; continue; }
    if (line.trimStart().startsWith("```")) {
      const language = line.trim().slice(3).trim() || "code";
      const code: string[] = [];
      index++;
      while (index < lines.length && !lines[index]!.trimStart().startsWith("```")) code.push(lines[index++]!);
      if (index < lines.length) index++;
      blocks.push(<div className="ai-code-block" key={blocks.length}><div>{language}</div><pre><code>{highlightedCode(code.join("\n"))}</code></pre></div>);
      continue;
    }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push(<h4 key={blocks.length} className="ai-markdown-heading">{inlineNodes(heading[2]!, onOpenFile)}</h4>);
      index++;
      continue;
    }
    const list = /^\s*(?:([-*])|(\d+)\.)\s+(.+)$/.exec(line);
    if (list) {
      const ordered = Boolean(list[2]);
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const item = /^\s*(?:([-*])|(\d+)\.)\s+(.+)$/.exec(lines[index]!);
        if (!item || Boolean(item[2]) !== ordered) break;
        items.push(<li key={items.length}>{inlineNodes(item[3]!, onOpenFile)}</li>);
        index++;
      }
      blocks.push(ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
      continue;
    }
    if (line.startsWith(">")) {
      blocks.push(<blockquote key={blocks.length}>{inlineNodes(line.replace(/^>\s?/, ""), onOpenFile)}</blockquote>);
      index++;
      continue;
    }
    const paragraph: string[] = [line];
    index++;
    while (index < lines.length && lines[index]!.trim() && !isBlockStart(lines[index]!)) paragraph.push(lines[index++]!);
    blocks.push(<p key={blocks.length}>{paragraph.map((part, lineIndex) => <span key={lineIndex}>{lineIndex > 0 && <br/>}{inlineNodes(part, onOpenFile)}</span>)}</p>);
  }
  return <div className="ai-markdown">{blocks}</div>;
}
