import { describe, expect, it } from "vitest";
import type { HdlIndex } from "../types";
import { completionCandidates, definitionFor, referencesFor, searchableSymbols } from "./hdl-intelligence";

const index: HdlIndex = {
  top: "top",
  files: ["rtl/top.sv", "rtl/uart.sv", "rtl/defs.svh"],
  symbols: [
    { name: "top", kind: "module", file: "rtl/top.sv", line: 1, column: 8, detail: "module" },
    { name: "uart", kind: "module", file: "rtl/uart.sv", line: 1, column: 8, detail: "module" },
    { name: "WIDTH", kind: "parameter", file: "rtl/uart.sv", line: 2, column: 15, detail: "parameter declaration" },
    { name: "busy", kind: "logic", file: "rtl/uart.sv", line: 8, column: 9, detail: "logic declaration" },
  ],
  references: [
    { name: "uart", file: "rtl/uart.sv", line: 1, column: 8, declaration: true },
    { name: "uart", file: "rtl/top.sv", line: 8, column: 3, declaration: false },
  ],
  diagnostics: [], instances: [], clockDomains: [], signals: [],
  modules: [{ name: "uart", file: "rtl/uart.sv", line: 1, ports: ["clk", "tx"], portDetails: [
    { name: "clk", direction: "input", dataType: "logic" },
    { name: "tx", direction: "output", dataType: "logic" },
  ] }],
};

describe("project-aware HDL intelligence", () => {
  it("limits module-instantiation completion to the module ports", () => {
    const text = "module top;\n  uart u_uart (\n    .";
    const items = completionCandidates(index, text, text.length);
    expect(items.map((item) => item.label)).toEqual(["clk", "tx"]);
    expect(items.every((item) => item.kind === "port")).toBe(true);
  });

  it("suggests project include files and normal symbols in their proper contexts", () => {
    const include = '`include "de';
    expect(completionCandidates(index, include, include.length).map((item) => item.label)).toContain("rtl/defs.svh");
    const regular = "always_ff @(posedge clk) begin\n  ";
    const labels = completionCandidates(index, regular, regular.length).map((item) => item.label);
    expect(labels).toContain("busy");
    expect(labels).toContain("WIDTH");
    expect(labels).not.toContain("uart");
  });

  it("resolves definitions, references, and symbol queries from the shared index", () => {
    expect(definitionFor(index, "uart")?.file).toBe("rtl/uart.sv");
    expect(referencesFor(index, "uart")).toHaveLength(2);
    expect(searchableSymbols(index, "width")[0]?.kind).toBe("parameter");
  });

  it("keeps completion comfortably below an interactive latency budget", () => {
    const large: HdlIndex = { ...index, symbols: Array.from({ length: 5_000 }, (_, i) => ({ name: `signal_${i}`, kind: "logic", file: "rtl/large.sv", line: i + 1, column: 1, detail: "logic declaration" })) };
    const started = performance.now();
    const items = completionCandidates(large, "assign value = ", 15);
    expect(items.length).toBeGreaterThanOrEqual(5_000);
    expect(performance.now() - started).toBeLessThan(100);
  });
});
