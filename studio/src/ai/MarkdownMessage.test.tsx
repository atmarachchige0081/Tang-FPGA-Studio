// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownMessage } from "./MarkdownMessage";

afterEach(cleanup);

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


describe("AI Markdown tables", () => {
  it("renders the reported file mapping, including a table immediately after prose", () => {
    const openFile = vi.fn();
    const { container } = render(<MarkdownMessage text={"Files in this project\n| File | What it does |\n| --- | --- |\n| `rtl/top.sv` | Connects the **CPU** to the board. |\n| rtl/cpu16.sv:12 | Implements registers. |\n\nAfter the table."} onOpenFile={openFile}/>);
    expect(screen.getAllByRole("columnheader").map(cell => cell.textContent)).toEqual(["File", "What it does"]);
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.getByText("rtl/top.sv").tagName).toBe("CODE");
    expect(screen.getByText("CPU").tagName).toBe("STRONG");
    fireEvent.click(screen.getByRole("button", { name: "rtl/cpu16.sv:12" }));
    expect(openFile).toHaveBeenCalledWith("rtl/cpu16.sv", 12, 1);
    expect(container.textContent).not.toContain("| --- |");
    expect(screen.getByText("After the table.").closest("table")).toBeNull();
  });

  it("handles optional outer pipes, alignment, escaped pipes and uneven rows", () => {
    render(<MarkdownMessage text={String.raw`Name | Value
:--- | ---:
a\|b | 27
short |
extra | 5 | ignored`} onOpenFile={() => undefined}/>);
    expect(screen.getAllByRole("columnheader")[1]?.style.textAlign).toBe("right");
    expect(screen.getByText("a|b")).toBeTruthy();
    expect(screen.getAllByRole("cell")).toHaveLength(6);
    expect(screen.queryByText("ignored")).toBeNull();
    expect(screen.getByRole("region", { name: "Message table" }).tabIndex).toBe(0);
  });

  it("keeps incomplete streamed tables as text until the separator is complete", () => {
    const ui = render(<MarkdownMessage text={"| File | Description |\n| --"} onOpenFile={() => undefined}/>);
    expect(screen.queryByRole("table")).toBeNull();
    ui.rerender(<MarkdownMessage text={"| File | Description |\n| --- | --- |\n| top.sv | Top |"} onOpenFile={() => undefined}/>);
    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("leaves pipe expressions and fenced code alone and never renders raw HTML", () => {
    const { container } = render(<MarkdownMessage text={'a | b\nnot a separator\n\n```sv\n| a | b |\n| --- | --- |\n```\n\n| Name | Value |\n| --- | --- |\n| <img src=x onerror=alert(1)> | safe |'} onOpenFile={() => undefined}/>);
    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("pre")?.textContent).toContain("| --- | --- |");
  });
});
