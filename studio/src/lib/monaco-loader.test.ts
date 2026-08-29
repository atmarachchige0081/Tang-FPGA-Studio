// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class EditorWorker {}
  return {
    config: vi.fn(),
    EditorWorker,
    monaco: { editor: { create: vi.fn() } },
  };
});

vi.mock("@monaco-editor/react", () => ({ loader: { config: mocks.config } }));
vi.mock("monaco-editor", () => mocks.monaco);
vi.mock("monaco-editor/editor/editor.worker?worker", () => ({ default: mocks.EditorWorker }));

import { configureBundledMonaco } from "./monaco-loader";

describe("Monaco production loader", () => {
  beforeEach(() => mocks.config.mockClear());

  it("uses the bundled Monaco package and a local worker instead of the default CDN", () => {
    configureBundledMonaco();

    expect(mocks.config).toHaveBeenCalledOnce();
    expect(mocks.config).toHaveBeenCalledWith({ monaco: mocks.monaco });

    const runtime = globalThis as typeof globalThis & {
      MonacoEnvironment?: { getWorker(): unknown };
    };
    expect(runtime.MonacoEnvironment?.getWorker()).toBeInstanceOf(mocks.EditorWorker);
  });
});
