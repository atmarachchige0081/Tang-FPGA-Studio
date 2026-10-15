import { describe, expect, it, vi } from "vitest";
import { completionText, inlineContext, InlineSuggestionService } from "./inline-completion";

describe("AI inline suggestions", () => {
  it("bounds code context and preserves indentation in fenced answers", () => {
    const context = inlineContext("a".repeat(10_000), 5000);
    expect(context.prefix.length).toBe(3000); expect(context.suffix.length).toBe(1500);
    expect(completionText("```systemverilog\n  assign led = clk;\n```" )).toBe("  assign led = clk;");
    expect(completionText("x".repeat(4001))).toBe("");
  });

  it("discards a response after the buffer changes and prevents parallel requests", async () => {
    let finish: (value: string) => void = () => undefined;
    let current = true;
    const request = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
    const service = new InlineSuggestionService(request);
    const first = service.suggest("module top;", 11, () => current);
    expect(await service.suggest("other", 5, () => true)).toBe("");
    current = false; finish("endmodule");
    expect(await first).toBe(""); expect(request).toHaveBeenCalledTimes(1);
  });
});
