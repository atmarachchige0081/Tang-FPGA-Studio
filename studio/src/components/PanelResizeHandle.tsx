import { useEffect, useRef, type CSSProperties } from "react";
import { create } from "zustand";

type Panel = "sidebar" | "assistant" | "bottom";
const defaults = { sidebar: 240, assistant: 390, bottom: 220 };
function stored(): typeof defaults {
  try {
    const data = JSON.parse(localStorage.getItem("fpga-studio.layout") ?? "{}");
    return Object.fromEntries(Object.entries(defaults).map(([key,value]) => [key, Number.isFinite(data[key]) ? Math.max(key === "bottom" ? 100 : 170, Math.min(data[key], 900)) : value])) as typeof defaults;
  } catch { return { ...defaults }; }
}
export const usePanelLayout = create<{ sizes: typeof defaults; set: (panel: Panel, value: number) => void; save: () => void }>((set,get) => ({
  sizes: stored(), set: (panel,value) => set((s) => ({ sizes: { ...s.sizes, [panel]: value } })),
  save: () => { try { localStorage.setItem("fpga-studio.layout", JSON.stringify(get().sizes)); } catch { /* Layout still works for this session. */ } },
}));
export function panelLayoutStyle(sizes: typeof defaults): CSSProperties { return { "--sidebar-width": `${sizes.sidebar}px`, "--assistant-width": `${sizes.assistant}px`, "--bottom-height": `${sizes.bottom}px` } as CSSProperties; }
export function PanelResizeHandle({ panel }: { panel: Panel }): React.JSX.Element {
  const { sizes, set, save } = usePanelLayout();
  const dragging = useRef<{ coordinate: number; value: number } | null>(null);
  const vertical = panel === "bottom";
  const limits = () => ({ min: vertical ? 100 : panel === "assistant" ? 320 : 170, max: vertical ? Math.max(100, window.innerHeight - 240) : Math.max(320, Math.min(800, window.innerWidth * .55)) });
  const update = (value: number) => { const { min,max } = limits(); set(panel, Math.round(Math.max(min,Math.min(max,value)))); };
  const finish = () => { dragging.current = null; document.body.classList.remove("resizing-panels"); save(); };
  useEffect(() => () => { document.body.classList.remove("resizing-panels"); }, []);
  return <div className={`panel-resizer ${vertical ? "horizontal" : "vertical"} resize-${panel}`} role="separator" tabIndex={0} aria-label={`Resize ${panel === "bottom" ? "bottom panel" : panel}`} aria-orientation={vertical ? "horizontal" : "vertical"} aria-valuemin={limits().min} aria-valuemax={limits().max} aria-valuenow={sizes[panel]} title="Drag to resize · Double-click to reset · Arrow keys to adjust"
    onPointerDown={(e) => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); dragging.current = { coordinate: vertical ? e.clientY : e.clientX, value: (() => { const element = e.currentTarget.closest(".app-shell")?.querySelector(panel === "bottom" ? ".bottom-dock" : panel === "assistant" ? ".ai-panel" : ".sidebar"); return element ? (vertical ? element.getBoundingClientRect().height : element.getBoundingClientRect().width) : sizes[panel]; })() }; document.body.classList.add("resizing-panels"); }}
    onPointerMove={(e) => { if (!dragging.current) return; const delta = (vertical ? e.clientY : e.clientX) - dragging.current.coordinate; update(dragging.current.value + (panel === "sidebar" ? delta : -delta)); }}
    onPointerUp={(e) => { if (dragging.current) { finish(); if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); } }} onPointerCancel={finish} onLostPointerCapture={() => { if (dragging.current) finish(); }}
    onDoubleClick={() => { set(panel, defaults[panel]); save(); }}
    onKeyDown={(e) => { const increase = vertical ? e.key === "ArrowUp" : panel === "sidebar" ? e.key === "ArrowRight" : e.key === "ArrowLeft"; const decrease = vertical ? e.key === "ArrowDown" : panel === "sidebar" ? e.key === "ArrowLeft" : e.key === "ArrowRight"; if (increase || decrease) { e.preventDefault(); update(sizes[panel] + (increase ? 1 : -1) * (e.shiftKey ? 40 : 10)); save(); } if (e.key === "Home") { e.preventDefault(); set(panel,defaults[panel]); save(); } }}/ >;
}
