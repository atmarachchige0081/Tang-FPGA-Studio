/** Monaco cancels superseded requests routinely; that is not an app failure. */
export function expectedCancellation(reason: unknown): boolean {
  return reason instanceof Error && reason.name === "Canceled" && reason.message === "Canceled";
}
