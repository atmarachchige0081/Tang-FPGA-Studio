export const RELEASE_NOTES_VERSION = "3.2.1";
const STORAGE_KEY = "fpga-studio.release-notes.seen";

export function releaseNotesPending(storage: Pick<Storage, "getItem"> = localStorage): boolean {
  try { return storage.getItem(STORAGE_KEY) !== RELEASE_NOTES_VERSION; }
  catch { return true; }
}

export function markReleaseNotesSeen(storage: Pick<Storage, "setItem"> = localStorage): void {
  try { storage.setItem(STORAGE_KEY, RELEASE_NOTES_VERSION); }
  catch { /* A read-only browser profile must never stop the application. */ }
}
