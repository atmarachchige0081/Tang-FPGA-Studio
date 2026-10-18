// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { confirmAction } from "./documents";

afterEach(() => { clearMocks(); vi.unstubAllGlobals(); });

it.each([['Ok', true], ['Cancel', false]] as const)("waits for the supported native message command (%s)", async (answer, expected) => {
  vi.stubGlobal("isTauri", true);
  const ipc = vi.fn((command, args) => {
    expect(command).toBe("plugin:dialog|message");
    expect(args).toMatchObject({ message: "Replace?", buttons: "OkCancel" });
    return answer;
  });
  mockIPC(ipc);
  expect(await confirmAction("Replace?")).toBe(expected);
  expect(ipc).toHaveBeenCalledOnce();
});
