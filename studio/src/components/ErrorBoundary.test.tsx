// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("component recovery", () => {
  it("recovers the failed section without replacing a sibling's unsaved input", async () => {
    vi.useFakeTimers(); vi.spyOn(console, "error").mockImplementation(() => undefined);
    let fail = true;
    function Panel() { if (fail) throw new Error("panel failed"); return <p>Panel restored</p>; }
    render(<><input aria-label="Unsaved editor" defaultValue="draft RTL"/><ErrorBoundary label="Assistant"><Panel/></ErrorBoundary></>);
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "edited RTL" } });
    fail = false;
    await act(() => vi.advanceTimersByTime(800));
    expect(screen.getByText("Panel restored")).toBeTruthy();
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("edited RTL");
  });

  it("stops automatic retries for a persistent failure and permits a manual retry", async () => {
    vi.useFakeTimers(); vi.spyOn(console, "error").mockImplementation(() => undefined);
    let fail = true;
    function Panel() { if (fail) throw new Error("persistent failure"); return <p>Recovered manually</p>; }
    render(<ErrorBoundary label="Editor"><Panel/></ErrorBoundary>);
    await act(() => vi.advanceTimersByTime(800));
    await act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByText("Editor needs attention")).toBeTruthy();
    fail = false; fireEvent.click(screen.getByRole("button", { name: "Retry Editor" }));
    expect(screen.getByText("Recovered manually")).toBeTruthy();
  });
});
