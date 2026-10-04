// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownMessage } from "./MarkdownMessage";

describe("AI message formatting", () => {
  it("renders emphasis, ordered steps, code, and project references without literal Markdown markers", () => {
    const openFile = vi.fn();
    const { container } = render(<MarkdownMessage text={"**Timing closure is unverified.**\n\n1. **Confirm the clock.** [fpga.config.psd1:14](</C:/Users/Example/My FPGA Project/fpga.config.psd1:14>)\n2. Measure `rtl/top.sv` before optimizing."} onOpenFile={openFile}/>);
    expect(screen.getByText("Timing closure is unverified.").tagName).toBe("STRONG");
    expect(screen.getByRole("list").children).toHaveLength(2);
    expect(screen.getByText("rtl/top.sv").tagName).toBe("CODE");
    expect(container.textContent).not.toContain("**");
    fireEvent.click(screen.getByRole("button", { name: "fpga.config.psd1:14" }));
    expect(openFile).toHaveBeenCalledWith("fpga.config.psd1", 14, 1);
  });
});
