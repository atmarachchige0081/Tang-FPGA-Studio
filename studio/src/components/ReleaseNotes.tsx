import { useEffect, useState } from "react";
import { Braces, CircuitBoard, Gauge, Route, Search, ShieldCheck, X } from "lucide-react";
import { markReleaseNotesSeen, releaseNotesPending, RELEASE_NOTES_VERSION } from "../lib/release-notes";

const highlights = [
  { icon: CircuitBoard, title: "Real Windows Verilator lint", text: "Studio launches the native OSS CAD Suite binary with its verified data root, preventing false passes, document popups, and stalled jobs." },
  { icon: Gauge, title: "Predictable test workloads", text: "Frontend tests use bounded workers so repeated and concurrent verification stays responsive on normal laptops." },
  { icon: Braces, title: "Safer serial example", text: "The beginner UART command console now rejects overlong commands and passes strict lint without hiding actionable HDL defects." },
  { icon: Route, title: "Clearer JTAG recovery", text: "Missing hardware, USB enumeration trouble, and Interface 0 driver problems receive distinct, beginner-safe guidance." },
  { icon: Search, title: "Reliable Windows release tools", text: "Policy-safe command wrappers run the release, stress, board, and screenshot checks from a normal terminal." },
  { icon: ShieldCheck, title: "3.2 workspace preserved", text: "Portable projects, HDL intelligence, navigation, professional dark/light themes, and registered Tang board routes remain fully available." },
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
  return <div className="release-overlay" role="presentation"><section className="release-dialog" role="dialog" aria-modal="true" aria-labelledby="release-title"><div className="release-top"><div className="release-symbol"><CircuitBoard size={27}/></div><div><span>FPGA STUDIO {RELEASE_NOTES_VERSION}</span><h2 id="release-title">A steadier professional FPGA workspace.</h2><p>Release 3.2.1 is a focused reliability hotfix for Windows tool execution, sustained test runs, example HDL correctness, and hardware recovery guidance.</p></div><button className="release-close" onClick={close} aria-label="Close release notes"><X size={18}/></button></div><div className="release-highlights">{highlights.map(({ icon: Icon, title, text }) => <article key={title}><Icon size={18}/><div><h3>{title}</h3><p>{text}</p></div></article>)}</div><div className="release-safety"><ShieldCheck size={18}/><span><strong>Honest support boundary:</strong> custom targets are limited to registered Tang/Gowin board routes. VHDL and arbitrary vendor devices are not presented as supported.</span></div><div className="release-actions"><span>Release notes appear once per version and remain available from Help.</span><button className="primary-button" onClick={close}>Open FPGA Studio 3.2.1</button></div></section></div>;
}
