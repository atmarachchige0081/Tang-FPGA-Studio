import type { AiAttachment } from "../types";

export const MAX_ATTACHMENTS = 6;
export const MAX_ATTACHMENT_TOTAL = 8 * 1024 * 1024;
export const ATTACHMENT_ACCEPT = ".png,.jpg,.jpeg,.gif,.webp,.txt,.md,.log,.v,.sv,.vh,.svh,.cst,.sdc,.json,.ps1,.psd1,.tcl,.py,.rs,.toml,.yaml,.yml,.csv,.c,.h,.cpp,.hpp";
const textExtensions = new Set(ATTACHMENT_ACCEPT.split(",").slice(5));
const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

function bytes(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Cannot read ${file.name}. Select it again.`));
    reader.onabort = () => reject(new Error(`Reading ${file.name} was cancelled.`));
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(file);
  });
}

function imageMime(data: Uint8Array): string | undefined {
  if ([137,80,78,71,13,10,26,10].every((byte, index) => data[index] === byte)) return "image/png";
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return "image/jpeg";
  const ascii = (start: number, end: number) => String.fromCharCode(...data.slice(start, end));
  if (["GIF87a", "GIF89a"].includes(ascii(0,6))) return "image/gif";
  if (ascii(0,4) === "RIFF" && ascii(8,12) === "WEBP") return "image/webp";
  return undefined;
}

export async function readAttachment(file: File): Promise<AiAttachment> {
  const name = file.name;
  const extension = /\.[^.]+$/.exec(name.toLowerCase())?.[0] ?? "";
  if (name.length > 180 || /[\\/\x00-\x1f]/.test(name) || /^\.env(?:\.|$)|^(?:credentials(?:\.json)?|id_rsa|id_ed25519)$/i.test(name)) throw new Error("Sensitive or invalid filenames cannot be attached.");
  const image = imageExtensions.has(extension);
  if (!image && !textExtensions.has(extension)) throw new Error(`${name}: choose a supported image or text/source file. PDFs and binary files are not supported.`);
  const limit = image ? 2 * 1024 * 1024 : 128 * 1024;
  if (!file.size || file.size > limit) throw new Error(`${name}: maximum size is ${image ? "2 MB per image" : "128 KB per text file"}; empty files cannot be attached.`);
  const data = new Uint8Array(await bytes(file));
  if (image) {
    const mime = imageMime(data);
    if (!mime) throw new Error(`${name} is not a supported image. Use PNG, JPEG, GIF or WebP.`);
    let binary = "";
    for (let index = 0; index < data.length; index += 8192) binary += String.fromCharCode(...data.slice(index, index + 8192));
    return { kind: "image", name, dataUrl: `data:${mime};base64,${btoa(binary)}` };
  }
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(data); }
  catch { throw new Error(`${name}: save the text file as UTF-8 before attaching it.`); }
  if (!text.length) throw new Error(`${name} is empty and cannot be attached.`);
  if (text.includes("\0")) throw new Error(`${name} contains binary data and cannot be attached as text.`);
  return { kind: "text", name, text };
}

export function validateAttachments(attachments: AiAttachment[]): void {
  if (attachments.length > MAX_ATTACHMENTS) throw new Error(`Attach up to ${MAX_ATTACHMENTS} files per message.`);
  const size = new TextEncoder().encode(JSON.stringify(attachments)).length;
  if (size > MAX_ATTACHMENT_TOTAL) throw new Error("Attachments exceed 8 MB. Remove a file or use smaller images.");
}
