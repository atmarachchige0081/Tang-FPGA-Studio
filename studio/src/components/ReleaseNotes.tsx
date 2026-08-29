import { useEffect, useState } from "react";
import { Braces, CircuitBoard, Gauge, Route, Search, ShieldCheck, X } from "lucide-react";
import { markReleaseNotesSeen, releaseNotesPending, RELEASE_NOTES_VERSION } from "../lib/release-notes";

const highlights = [
  { icon: CircuitBoard, title: "One coherent workspace", text: "A compact IDE shell makes the active project, source tree, editor, target board, output, and build state immediately visible." },
  { icon: Route, title: "Open configurable projects", text: "Choose a verified template or create a portable custom project with separate board, silicon target, timing, constraints, toolchain, and programmer records." },
  { icon: Braces, title: "Project-aware HDL intelligence", text: "Completion understands modules, ports, signals, parameters, local includes, and editing context; hover and signature help stay compact." },
  { icon: Search, title: "Navigation that leads somewhere", text: "Use definition, references, file, symbol, and project-text search. Problems and build diagnostics open their exact source location." },
  { icon: Gauge, title: "Dense engineering views", text: "Analysis, timing, utilization, traceability, and hardware data use structured panels and tables instead of dashboard tiles." },
  { icon: ShieldCheck, title: "Dark and light themes", text: "Both themes use restrained color, clear separators, readable focus states, and status colors reserved for meaning." },
];

export function ReleaseNotes(): React.JSX.Element | null {
  const capture = import.meta.env.DEV ? new URLSearchParams(window.location.search).get("capture") : null;
  const [open, setOpen] = useState(() => capture === "release-notes" || (!capture && releaseNotesPending()));
  useEffect(() => {
    const reveal = () => setOpen(true);
    window.addEventListener("fpga-studio:release-notes", reveal);
    return () => window.removeEventListener("fpga-studio:release-notes", reveal);
  }, []);
  if (!open) return null;
  const close = () => { markReleaseNotesSeen(); setOpen(false); };
  return <div className="release-overlay" role="presentation"><section className="release-dialog" role="dialog" aria-modal="true" aria-labelledby="release-title"><div className="release-top"><div className="release-symbol"><CircuitBoard size={27}/></div><div><span>FPGA STUDIO {RELEASE_NOTES_VERSION}</span><h2 id="release-title">A professional workspace for FPGA engineering.</h2><p>Release 3.2 combines the new desktop interface with portable configurable projects and real HDL navigation built from the local project index.</p></div><button className="release-close" onClick={close} aria-label="Close release notes"><X size={18}/></button></div><div className="release-highlights">{highlights.map(({ icon: Icon, title, text }) => <article key={title}><Icon size={18}/><div><h3>{title}</h3><p>{text}</p></div></article>)}</div><div className="release-safety"><ShieldCheck size={18}/><span><strong>Honest support boundary:</strong> custom targets are limited to registered Tang/Gowin board routes. VHDL and arbitrary vendor devices are not presented as supported.</span></div><div className="release-actions"><span>Release notes appear once per version and remain available from Help.</span><button className="primary-button" onClick={close}>Open FPGA Studio 3.2</button></div></section></div>;
}
