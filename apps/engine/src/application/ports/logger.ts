/** Diagnostics. Never stdout: it carries only the ready line. */
export interface Logger {
  log(message: string, err?: unknown): void;
}
