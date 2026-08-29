import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";

type MonacoRuntime = typeof globalThis & {
  MonacoEnvironment?: {
    getWorker(): Worker;
  };
};

export function configureBundledMonaco(): void {
  const runtime = globalThis as MonacoRuntime;
  runtime.MonacoEnvironment = {
    getWorker: () => new EditorWorker(),
  };
  loader.config({ monaco });
}

configureBundledMonaco();
