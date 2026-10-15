import { useEffect, useState } from "react";
import { Bot, CircuitBoard, ShieldCheck, Sparkles, X } from "lucide-react";
import { markReleaseNotesSeen, releaseNotesPending, RELEASE_NOTES_VERSION } from "../lib/release-notes";

const highlights = [
  { icon: CircuitBoard, title: "Windows and Ubuntu", text: "Use the shared FPGA workspace on Windows or Ubuntu 22.04 and newer LTS releases on x86_64." },
  { icon: Sparkles, title: "Native Linux packages", text: "Linux packages include the offline editor and seed a writable per-user workspace. Install the documented FPGA prerequisites separately." },
  { icon: CircuitBoard, title: "Shared FPGA workflows", text: "PowerShell 7 runs native Linux FPGA tools for lint, simulation, implementation, analyzer builds and optimization experiments." },
  { icon: ShieldCheck, title: "Linux USB and serial access", text: "Follow udev and dialout guidance on Linux. The Windows driver helper remains available on Windows." },
  { icon: ShieldCheck, title: "Stop owned tool processes", text: "Linux job cancellation stops the owned tool process group, including child tools." },
  { icon: Bot, title: "Keep your coding partner", text: "The project-aware AI assistant remains available with your own local Codex authentication and explicit approvals." },
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
  return <div className="release-overlay" role="presentation"><section className="release-dialog" role="dialog" aria-modal="true" aria-labelledby="release-title"><div className="release-top"><div className="release-symbol"><CircuitBoard size={27}/></div><div><span>FPGA STUDIO {RELEASE_NOTES_VERSION}</span><h2 id="release-title">Build on Windows and Ubuntu.</h2><p>Release 3.5 adds native Ubuntu packages, Linux FPGA workflows, and platform-aware hardware guidance.</p></div><button className="release-close" onClick={close} aria-label="Close release notes"><X size={18}/></button></div><div className="release-highlights">{highlights.map(({ icon: Icon, title, text }) => <article key={title}><Icon size={18}/><div><h3>{title}</h3><p>{text}</p></div></article>)}</div><div className="release-safety"><ShieldCheck size={18}/><span><strong>Bring your own account:</strong> no developer credential is included. Codex authentication stays local to each user, and FPGA programming still requires explicit approval.</span></div><div className="release-actions"><span>Release notes appear once per version and remain available from Help.</span><button className="primary-button" onClick={close}>Open FPGA Studio {RELEASE_NOTES_VERSION}</button></div></section></div>;
}
