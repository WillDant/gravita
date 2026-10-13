import type { SessionRuntimeRegistry } from "../ports/session-runtime";
import { requireRuntime } from "./require-runtime";

/** Stops the current turn of a session Gravita runs; the session stays open. */
export class InterruptSession {
  constructor(private readonly runtimes: SessionRuntimeRegistry) {}

  async execute(p: { sessionId: string }): Promise<{ ok: true }> {
    await requireRuntime(this.runtimes, p.sessionId).interrupt();
    return { ok: true };
  }
}
