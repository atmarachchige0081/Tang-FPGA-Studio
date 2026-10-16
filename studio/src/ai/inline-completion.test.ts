import { describe, expect, it, vi } from "vitest";
import { completionText, inlineContext, InlineSuggestionService } from "./inline-completion";

describe("AI inline suggestions", () => {
  it("bounds code context and preserves indentation in fenced answers", () => {
    const context = inlineContext("a".repeat(10_000), 5000);
    expect(context.prefix.length).toBe(3000); expect(context.suffix.length).toBe(1500);
    expect(completionText("```systemverilog\n  assign led = clk;\n```" )).toBe("  assign led = clk;");
    expect(completionText("x".repeat(4001))).toBe("");
  });

  it("discards superseded responses and queues the newest valid cursor", async () => {
    let finish: (value: string) => void = () => undefined;
    let current = true;
    const request = vi.fn().mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; })).mockResolvedValueOnce("new completion");
    const service = new InlineSuggestionService(request);
    const first = service.suggest("module top;", 11, () => current);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    const newest = service.suggest("module other;", 13, () => true);
    expect(request).toHaveBeenCalledTimes(1);
    current = false; finish("old completion");
    expect(await first).toBe(""); expect(await newest).toBe("new completion"); expect(request).toHaveBeenCalledTimes(2);
  });

  it("skips cancelled queued work and recovers after a provider error", async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue("recovered");
    const service = new InlineSuggestionService(request);
    await expect(service.suggest("a",1,() => true)).rejects.toThrow("offline");
    expect(await service.suggest("b",1,() => false)).toBe("");
    expect(await service.suggest("c",1,() => true)).toBe("recovered");
    expect(request).toHaveBeenCalledTimes(2);
  });
});
