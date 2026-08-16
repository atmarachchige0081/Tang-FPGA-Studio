import { useEffect, useState } from "react";
import { CircuitBoard, FlaskConical, Gauge, History, Route, ShieldCheck, Waves, X } from "lucide-react";
import { markReleaseNotesSeen, releaseNotesPending, RELEASE_NOTES_VERSION } from "../lib/release-notes";

const highlights = [
  { icon: Route, title: "Cross-domain traceability", text: "Follow RTL signals through synthesized cells, routed nets, physical locations, timing segments, and analyzer probes." },
  { icon: Waves, title: "Real on-chip analyzer", text: "Choose internal post-synthesis probes, configure AND triggers and pre-trigger depth, then capture measured samples over UART." },
  { icon: Gauge, title: "Evidence-aware design health", text: "Verification, timing, depth, fanout, area, memory, I/O, clock/reset, observability, and hardware clearly separate measurement from inference." },
  { icon: FlaskConical, title: "Safe build experiments", text: "Run isolated retiming or placement-seed experiments without modifying RTL or replacing your baseline artifacts." },
  { icon: History, title: "Snapshots and regressions", text: "Compare resources, Fmax, slack, verification state, analyzer configuration, tools, and source identity across builds." },
  { icon: CircuitBoard, title: "Guided intelligence demo", text: "Learn the complete workflow on a verified UART protocol with useful internal counters, state, and error evidence." },
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
  return <div className="release-overlay" role="presentation"><section className="release-dialog" role="dialog" aria-modal="true" aria-labelledby="release-title"><div className="release-top"><div className="release-symbol"><CircuitBoard size={27}/></div><div><span>FPGA STUDIO {RELEASE_NOTES_VERSION}</span><h2 id="release-title">See the whole design. Prove it on silicon.</h2><p>Release 3.0 unifies implementation traceability, physical signal capture, and evidence-backed optimization in one local workflow.</p></div><button className="release-close" onClick={close} aria-label="Close release notes"><X size={18}/></button></div><div className="release-highlights">{highlights.map(({ icon: Icon, title, text }) => <article key={title}><Icon size={18}/><div><h3>{title}</h3><p>{text}</p></div></article>)}</div><div className="release-safety"><ShieldCheck size={18}/><span><strong>Safe and honest:</strong> analyzer images use volatile SRAM, experiments are isolated, source RTL stays untouched, and unavailable evidence is never invented.</span></div><div className="release-actions"><span>Release notes appear once per version and remain available from Help.</span><button className="primary-button" onClick={close}>Explore FPGA Studio 3.0</button></div></section></div>;
}
