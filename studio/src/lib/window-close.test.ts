// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit, TauriEvent } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import capability from "../../src-tauri/capabilities/default.json";

afterEach(clearMocks);

it("permits the SDK close listener's destroy command only in the main window capability", async () => {
  expect(capability.windows).toEqual(["main"]);
  expect(capability.permissions).toContain("core:window:allow-destroy");
  const ipc = vi.fn((command: string, args: unknown) => {
    expect(command).toBe("plugin:window|destroy");
    expect(args).toEqual({ label: "main" });
  });
  mockIPC(ipc, { shouldMockEvents: true });
  mockWindows("main");
  const unlisten = await getCurrentWindow().onCloseRequested(() => undefined);
  try {
    await emit(TauriEvent.WINDOW_CLOSE_REQUESTED);
    await waitFor(() => expect(ipc).toHaveBeenCalledExactlyOnceWith("plugin:window|destroy", { label: "main" }));
  } finally { await unlisten(); }
});

it("does not destroy the window when a close guard prevents the request", async () => {
  const ipc = vi.fn();
  mockIPC(ipc, { shouldMockEvents: true });
  mockWindows("main");
  const guard = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
  const unlisten = await getCurrentWindow().onCloseRequested(guard);
  try {
    await emit(TauriEvent.WINDOW_CLOSE_REQUESTED);
    await waitFor(() => expect(guard).toHaveBeenCalledOnce());
    expect(ipc).not.toHaveBeenCalled();
  } finally { await unlisten(); }
});
