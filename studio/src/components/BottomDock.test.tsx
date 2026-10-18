// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useWorkbench } from "../store/workbench";
import { BottomDock } from "./BottomDock";
vi.mock("./TerminalPane", () => ({ TerminalPane: () => null }));
afterEach(cleanup);
it("shows a fileless job failure in Problems without claiming the project is clean", () => {
  const message = "No JTAG programmer was found. Connect the Dock JTAG/UART port and try Detect again.";
  useWorkbench.setState({ bottomPanel: "problems", bottomOpen: true, diagnostics: [{ severity: "error", source: "toolchain", message }] });
  render(<BottomDock/>);
  expect(screen.getByText(message)).toBeTruthy();
  expect(screen.queryByText("No problems detected in the active project.")).toBeNull();
  expect(screen.getByRole("button", { name: /No JTAG programmer/ }).hasAttribute("disabled")).toBe(true);
});
