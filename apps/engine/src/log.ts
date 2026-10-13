/** Diagnostics go to stderr: stdout carries only the ready line. */
export function log(message: string, err?: unknown) {
  const detail = err instanceof Error ? err.message : err === undefined ? "" : String(err);
  console.error(`[gravita-engine] ${message}${detail ? `: ${detail}` : ""}`);
}
