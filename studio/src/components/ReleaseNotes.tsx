import { useEffect, useState } from "react";
import { Bot, CircuitBoard, FilePlus2, FolderSearch2, Save, ShieldCheck, X } from "lucide-react";
import { markReleaseNotesSeen, releaseNotesPending, RELEASE_NOTES_VERSION } from "../lib/release-notes";

const highlights = [
  { icon: FilePlus2, title: "Projects named your way", text: "Use clear names with spaces, mixed case, and Unicode, then choose a safe destination from the native Windows folder picker." },
  { icon: FolderSearch2, title: "A working Explorer", text: "Create files and folders, refresh the tree, and search files, symbols, or project text from the left dock." },
  { icon: Save, title: "Safer editing and replace", text: "Serialized native writes, interrupted-save recovery, dirty-buffer guards, and transactional Replace All protect work under failure." },
  { icon: Bot, title: "AI-ready projects", text: "Every template and custom project receives an AGENTS.md guide explaining the Studio layout, commands, safety rules, and verification flow." },
  { icon: CircuitBoard, title: "Custom projects included", text: "Custom board projects receive the same guidance and portable structure as built-in examples without forcing numbered folder names." },
  { icon: ShieldCheck, title: "Hardened workspace boundaries", text: "Symlink escapes, oversized manifests and reports, unbounded Git output, and malformed project paths are rejected safely." },
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
  return <div className="release-overlay" role="presentation"><section className="release-dialog" role="dialog" aria-modal="true" aria-labelledby="release-title"><div className="release-top"><div className="release-symbol"><CircuitBoard size={27}/></div><div><span>FPGA STUDIO {RELEASE_NOTES_VERSION}</span><h2 id="release-title">Projects that fit the way you work.</h2><p>Release 3.3.0 removes rigid project naming, completes the Explorer workflow, and hardens editing from file open through save and project-wide replace.</p></div><button className="release-close" onClick={close} aria-label="Close release notes"><X size={18}/></button></div><div className="release-highlights">{highlights.map(({ icon: Icon, title, text }) => <article key={title}><Icon size={18}/><div><h3>{title}</h3><p>{text}</p></div></article>)}</div><div className="release-safety"><ShieldCheck size={18}/><span><strong>Installer clarity:</strong> the dedicated Windows installer explicitly offers the verified OSS CAD Suite and signed Zadig helper downloads. Driver replacement remains a guided Interface 0-only action.</span></div><div className="release-actions"><span>Release notes appear once per version and remain available from Help.</span><button className="primary-button" onClick={close}>Open FPGA Studio 3.3.0</button></div></section></div>;
}
