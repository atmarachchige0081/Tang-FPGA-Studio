import { useEffect, useState } from "react";
import { Bot, BrainCircuit, CircuitBoard, ShieldCheck, Sparkles, X } from "lucide-react";
import { markReleaseNotesSeen, releaseNotesPending, RELEASE_NOTES_VERSION } from "../lib/release-notes";

const highlights = [
  { icon: Bot, title: "AI assistant in your workspace", text: "Discuss RTL and diagnostics, review proposed edits, and run approved FPGA workflows without leaving Studio." },
  { icon: BrainCircuit, title: "Choose your model", text: "Pick from the connected Codex provider's model catalog and supported thinking levels before a turn." },
  { icon: Sparkles, title: "Readable live responses", text: "Streaming answers preserve their spacing, with visible activity, conversation history, and stop/retry controls." },
  { icon: ShieldCheck, title: "Your account, your approvals", text: "Sign in locally with your own ChatGPT account or API key. Commands and project changes remain approval-gated." },
  { icon: CircuitBoard, title: "Safer hardware tools", text: "The assistant can request project checks and FPGA actions, while duplicate tool execution is blocked." },
  { icon: ShieldCheck, title: "Installer starts offline", text: "The production app embeds its UI and is smoke-tested before the one-file Windows installer is published." },
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
  return <div className="release-overlay" role="presentation"><section className="release-dialog" role="dialog" aria-modal="true" aria-labelledby="release-title"><div className="release-top"><div className="release-symbol"><CircuitBoard size={27}/></div><div><span>FPGA STUDIO {RELEASE_NOTES_VERSION}</span><h2 id="release-title">Build with a coding partner.</h2><p>Release 3.4 adds a project-aware AI assistant, model selection, and a production installer startup fix.</p></div><button className="release-close" onClick={close} aria-label="Close release notes"><X size={18}/></button></div><div className="release-highlights">{highlights.map(({ icon: Icon, title, text }) => <article key={title}><Icon size={18}/><div><h3>{title}</h3><p>{text}</p></div></article>)}</div><div className="release-safety"><ShieldCheck size={18}/><span><strong>Bring your own account:</strong> no developer credential is included. Codex authentication stays local to each user, and FPGA programming still requires explicit approval.</span></div><div className="release-actions"><span>Release notes appear once per version and remain available from Help.</span><button className="primary-button" onClick={close}>Open FPGA Studio 3.4.0</button></div></section></div>;
}
