export function inlineSuggestionsEnabled(): boolean {
  try { return localStorage.getItem("fpga-studio.ai.inline") === "true"; } catch { return false; }
}

export function setInlineSuggestions(enabled: boolean): void {
  try { localStorage.setItem("fpga-studio.ai.inline", String(enabled)); } catch { /* Keep the editor usable with blocked storage. */ }
}

export function inlineContext(source: string, offset: number): { prefix: string; suffix: string } {
  const cursor = Math.max(0, Math.min(offset, source.length));
  return { prefix: source.slice(Math.max(0, cursor - 3000), cursor), suffix: source.slice(cursor, cursor + 1500) };
}

export function completionText(value: string): string {
  const text = value.replace(/^```[^\n]*\r?\n/, "").replace(/\r?\n```\s*$/, "");
  return text.length <= 4000 && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text) ? text : "";
}

/** One request at a time. A changed cursor/buffer can never receive an old edit. */
export class InlineSuggestionService {
  private busy = false;
  constructor(private readonly request: (prefix: string, suffix: string) => Promise<string>) {}

  async suggest(source: string, offset: number, current: () => boolean): Promise<string> {
    if (this.busy || !current()) return "";
    this.busy = true;
    try {
      const context = inlineContext(source, offset);
      const text = completionText(await this.request(context.prefix, context.suffix));
      return current() ? text : "";
    } finally { this.busy = false; }
  }
}
