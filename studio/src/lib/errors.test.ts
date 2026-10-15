import { describe, expect, it } from "vitest";
import { expectedCancellation } from "./errors";

describe("runtime error reporting", () => {
  it("ignores only Monaco's normal cancellation signal", () => {
    const cancellation = new Error("Canceled"); cancellation.name = "Canceled";
    expect(expectedCancellation(cancellation)).toBe(true);
    expect(expectedCancellation(new Error("Canceled"))).toBe(false);
    expect(expectedCancellation(new Error("Programming failed"))).toBe(false);
    expect(expectedCancellation(null)).toBe(false);
  });
});
