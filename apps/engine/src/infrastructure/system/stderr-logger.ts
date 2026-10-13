import type { Logger } from "../../application/ports/logger";

/** Diagnostics go to stderr: stdout carries only the ready line. */
export class StderrLogger implements Logger {
  log(message: string, err?: unknown) {
    const detail = err instanceof Error ? err.message : err === undefined ? "" : String(err);
    console.error(`[gravita-engine] ${message}${detail ? `: ${detail}` : ""}`);
  }
}
