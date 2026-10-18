import { confirmAction } from "../lib/documents";
import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { RotateCcw, Square } from "lucide-react";
import { bridge, type TerminalEvent } from "../lib/bridge";
import { useWorkbench } from "../store/workbench";
import "@xterm/xterm/css/xterm.css";

export function TerminalPane(): React.JSX.Element {
  const { root, projectPath, theme } = useWorkbench();
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const session = useRef<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const [error, setError] = useState("");
  const [exited, setExited] = useState(false);
  const [ready, setReady] = useState(false);
  const [restarting, setRestarting] = useState(false);
  useEffect(() => {
    if (!root || !host.current) return;
    let disposed = false, stop: (() => void) | undefined, sequence = -1;
    let queue: TerminalEvent[] = [], writes = Promise.resolve();
    let resizeFrame: number | undefined;
    let lastWidth = -1, lastHeight = -1;
    session.current = null; setReady(false); setExited(false); setError("");
    const term = new Terminal({ fontFamily: "Consolas, 'Cascadia Code', monospace", fontSize: 13, lineHeight: 1.2, cursorBlink: true, scrollback: 3000, allowProposedApi: false });
    terminal.current = term;
    const fit = new FitAddon(); term.loadAddon(fit); term.open(host.current);
    const colours = () => { const style = getComputedStyle(host.current!); term.options.theme = { background: style.getPropertyValue("--surface").trim(), foreground: style.getPropertyValue("--text").trim(), cursor: style.getPropertyValue("--accent-strong").trim(), selectionBackground: "#58718788" }; };
    colours();
    const receive = (event: TerminalEvent) => {
      if (disposed) return;
      if (!session.current) { queue.push(event); if (queue.length > 1000) queue.shift(); return; }
      if (event.id !== session.current || event.sequence <= sequence) return;
      sequence = event.sequence; if (event.data) term.write(event.data); setExited(event.exited);
    };
    const resize = () => {
      if (disposed || !host.current?.clientWidth || !host.current?.clientHeight) return;
      fit.fit(); colours();
      if (session.current) void bridge.terminalResize(session.current, term.cols, term.rows).catch((reason) => { if (!disposed) setError(String(reason)); });
    };
    const clear = () => term.clear();
    const copy = () => {
      const lines: string[] = [];
      for (let i = 0; i < term.buffer.active.length; i++) lines.push(term.buffer.active.getLine(i)?.translateToString(true) ?? "");
      void navigator.clipboard.writeText(term.getSelection() || lines.join("\n")).catch((reason) => { if (!disposed) setError(String(reason)); });
    };
    window.addEventListener("fpga-studio:terminal-clear",clear); window.addEventListener("fpga-studio:terminal-copy",copy);
    // Fit changes the viewport layout; defer it beyond ResizeObserver delivery.
    const observer = new ResizeObserver(([entry]) => {
      if (disposed || !entry) return;
      const { width, height } = entry.contentRect;
      if (width === lastWidth && height === lastHeight) return;
      lastWidth = width; lastHeight = height;
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => { resizeFrame = undefined; resize(); });
    }); observer.observe(host.current);
    const input = term.onData((data) => {
      const id = session.current; if (!id || disposed) return;
      writes = writes.then(() => bridge.terminalWrite(id,data)).catch((reason) => { if (!disposed) setError(String(reason)); });
    });
    void (async () => {
      stop = await bridge.onTerminalEvent(receive);
      if (disposed) { stop(); return; }
      fit.fit();
      const snapshot = await bridge.terminalOpen(root, projectPath, Math.max(10,term.cols), Math.max(2,term.rows));
      if (disposed) return; // Session remains available for remount; never replay input.
      session.current = snapshot.id; sequence = snapshot.sequence;
      term.write(snapshot.data); setExited(snapshot.exited); setReady(true);
      queue.forEach(receive); queue = []; resize();
    })().catch((reason) => { if (!disposed) setError(String(reason)); });
    return () => { disposed = true; window.removeEventListener("fpga-studio:terminal-clear",clear); window.removeEventListener("fpga-studio:terminal-copy",copy); stop?.(); observer.disconnect(); if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame); input.dispose(); term.dispose(); terminal.current = null; session.current = null; };
  }, [root, projectPath, generation]);
  useEffect(() => {
    if (!terminal.current || !host.current) return;
    const style = getComputedStyle(host.current);
    terminal.current.options.theme = { background: style.getPropertyValue("--surface").trim(), foreground: style.getPropertyValue("--text").trim(), cursor: style.getPropertyValue("--accent-strong").trim(), selectionBackground: "#58718788" };
  }, [theme]);
  const restart = async () => {
    if (restarting) return;
    const id = session.current;
    setRestarting(true);
    try {
      if (id && !exited && !await confirmAction("Restart this shell? Any commands running in it will stop.")) return;
      if (session.current !== id) return;
      if (id) await bridge.terminalClose(id);
      setGeneration((v) => v+1);
    }
    catch (reason) { setError(String(reason)); }
    finally { setRestarting(false); }
  };
  return <div className="terminal-pane">
    <div className="terminal-toolbar"><span>{ready ? exited ? "Shell exited" : "Shell" : "Opening shell…"}</span><code title={projectPath}>{projectPath}</code><button disabled={!ready || exited} onClick={() => { if (session.current) void bridge.terminalWrite(session.current,"\u0003").catch((reason) => setError(String(reason))); }} title="Interrupt command (Ctrl+C)"><Square size={12}/> Interrupt</button><button disabled={restarting} onClick={() => void restart()}><RotateCcw size={12}/> Restart</button></div>
    {error && <div className="terminal-error" role="alert">{error}</div>}
    <div className="terminal-host" ref={host} aria-label="Project shell" onPointerDown={() => terminal.current?.focus()}/>
  </div>;
}
