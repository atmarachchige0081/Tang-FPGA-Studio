import { useEffect, useRef, useState } from "react";
import type { AiAttachment } from "../types";
import { readAttachment, validateAttachments, MAX_ATTACHMENTS } from "./attachments";

export function useAttachments(scope: string) {
  const [attachments, setAttachments] = useState<AiAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lifetime = useRef(0);
  const reading = useRef(false);
  useEffect(() => {
    lifetime.current++;
    reading.current = false;
    setAttachments([]); setLoading(false); setError(null);
    return () => { lifetime.current++; };
  }, [scope]);
  const add = async (files: File[]) => {
    if (!files.length || reading.current) return;
    if (files.length + attachments.length > MAX_ATTACHMENTS) { setError(`Attach up to ${MAX_ATTACHMENTS} files per message.`); return; }
    const epoch = lifetime.current;
    reading.current = true; setLoading(true); setError(null);
    try {
      // Bound retained memory before reading; unsupported inputs are rejected by readAttachment.
      if (files.some(file => file.size > 2 * 1024 * 1024)) throw new Error("Use images up to 2 MB or text files up to 128 KB.");
      const loaded = [];
      for (const file of files) loaded.push(await readAttachment(file));
      if (epoch !== lifetime.current) return;
      const next = [...attachments, ...loaded];
      validateAttachments(next); setAttachments(next);
    } catch (reason) {
      if (epoch === lifetime.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (epoch === lifetime.current) { reading.current = false; setLoading(false); }
    }
  };
  return { attachments, loading, error, add, clear: () => { setAttachments([]); setError(null); }, remove: (index: number) => setAttachments(current => current.filter((_, item) => item !== index)) };
}
