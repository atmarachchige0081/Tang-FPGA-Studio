import { FileText, X } from "lucide-react";
import type { AiAttachment } from "../types";

export function AttachmentList({ attachments, onRemove, disabled = false }: { attachments: AiAttachment[]; onRemove?: (index: number) => void; disabled?: boolean }): React.JSX.Element {
  return <ul className="ai-attachments" aria-label={onRemove ? "Files to send" : "Sent attachments"}>{attachments.map((file, index) => <li key={`${index}-${file.name}`}>
    {file.kind === "image" ? <img src={file.dataUrl} alt={`Attachment: ${file.name}`}/> : <FileText size={20} aria-hidden="true"/>}
    <span title={file.name}>{file.name}<small>{file.kind === "image" ? "Image" : "Text file"}</small></span>
    {onRemove && <button type="button" disabled={disabled} aria-label={`Remove attachment ${file.name}`} onClick={() => onRemove(index)}><X size={13}/></button>}
  </li>)}</ul>;
}
