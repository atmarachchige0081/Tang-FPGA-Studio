import { useEffect, useState } from "react";
import { CircuitBoard, Gauge, History, Route, ShieldCheck, Waves, X } from "lucide-react";
import { markReleaseNotesSeen, releaseNotesPending, RELEASE_NOTES_VERSION } from "../lib/release-notes";

const highlights = [
  { icon: CircuitBoard, title: "Tang Console 60K", text: "Exact GW5AT-60B/PG484A metadata, 50 MHz clock, independent 1.5 V button constraints, BL616 programming, and a Gowin EDA build route." },
  { icon: CircuitBoard, title: "Tang Console 138K", text: "Current GW5AST-138C/PG484A silicon builds with the bundled open-source database and uses its own 3.3 V button constraints." },
  { icon: Route, title: "Backend-aware projects", text: "Generated projects persist the board, silicon revision, constraints, timing file, programmer alias, and appropriate build backend." },
  { icon: Waves, title: "Verified beginner starter", text: "A self-checking 50 MHz lesson teaches active-low buttons, reset, counting, and the two Console LEDs without inherited Primer pins." },
  { icon: Gauge, title: "Actionable prerequisites", text: "Missing Gowin EDA or programmer tools produce a focused installation message instead of an unknown-device crash." },
  { icon: History, title: "Regression protected", text: "Registry, generation, persistence, simulation, and representative device builds cover the new targets and existing Tang boards." },
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
  return <div className="release-overlay" role="presentation"><section className="release-dialog" role="dialog" aria-modal="true" aria-labelledby="release-title"><div className="release-top"><div className="release-symbol"><CircuitBoard size={27}/></div><div><span>FPGA STUDIO {RELEASE_NOTES_VERSION}</span><h2 id="release-title">Tang Console joins the Studio.</h2><p>Release 3.1 adds complete project-generation and programming support for Console 60K and current 138K hardware, with honest toolchain routing.</p></div><button className="release-close" onClick={close} aria-label="Close release notes"><X size={18}/></button></div><div className="release-highlights">{highlights.map(({ icon: Icon, title, text }) => <article key={title}><Icon size={18}/><div><h3>{title}</h3><p>{text}</p></div></article>)}</div><div className="release-safety"><ShieldCheck size={18}/><span><strong>Revision safe:</strong> 60K and 138K constraints are independent, and the 138K profile explicitly targets current C-revision silicon instead of silently treating B and C as interchangeable.</span></div><div className="release-actions"><span>Release notes appear once per version and remain available from Help.</span><button className="primary-button" onClick={close}>Explore FPGA Studio 3.1</button></div></section></div>;
}
