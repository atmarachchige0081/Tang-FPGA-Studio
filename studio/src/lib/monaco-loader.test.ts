// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class EditorWorker {}
  class CssWorker {}
  class HtmlWorker {}
  class JsonWorker {}
  class TypeScriptWorker {}
  return {
    config: vi.fn(),
    EditorWorker,
    CssWorker,
    HtmlWorker,
    JsonWorker,
    TypeScriptWorker,
    monaco: { editor: { create: vi.fn() } },
  };
});

vi.mock("@monaco-editor/react", () => ({ loader: { config: mocks.config } }));
vi.mock("monaco-editor", () => mocks.monaco);
vi.mock("monaco-editor/editor/editor.worker?worker", () => ({ default: mocks.EditorWorker }));
vi.mock("monaco-editor/language/css/css.worker.js?worker", () => ({
  default: mocks.CssWorker,
}));
vi.mock("monaco-editor/language/html/html.worker.js?worker", () => ({
  default: mocks.HtmlWorker,
}));
vi.mock("monaco-editor/language/json/json.worker.js?worker", () => ({
  default: mocks.JsonWorker,
}));
vi.mock("monaco-editor/language/typescript/ts.worker.js?worker", () => ({
  default: mocks.TypeScriptWorker,
}));

import { configureBundledMonaco } from "./monaco-loader";

describe("Monaco production loader", () => {
  beforeEach(() => mocks.config.mockClear());

  it("uses bundled Monaco and routes each language to its local worker", () => {
    configureBundledMonaco();

    expect(mocks.config).toHaveBeenCalledOnce();
    expect(mocks.config).toHaveBeenCalledWith({ monaco: mocks.monaco });

    const runtime = globalThis as typeof globalThis & {
      MonacoEnvironment?: { getWorker(moduleId: string, label: string): unknown };
    };
    const getWorker = runtime.MonacoEnvironment?.getWorker;
    expect(getWorker?.("", "json")).toBeInstanceOf(mocks.JsonWorker);
    expect(getWorker?.("", "css")).toBeInstanceOf(mocks.CssWorker);
    expect(getWorker?.("", "scss")).toBeInstanceOf(mocks.CssWorker);
    expect(getWorker?.("", "html")).toBeInstanceOf(mocks.HtmlWorker);
    expect(getWorker?.("", "typescript")).toBeInstanceOf(mocks.TypeScriptWorker);
    expect(getWorker?.("", "javascript")).toBeInstanceOf(mocks.TypeScriptWorker);
    expect(getWorker?.("", "systemverilog")).toBeInstanceOf(mocks.EditorWorker);
  });
});
