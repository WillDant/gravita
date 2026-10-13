import type { SessionRuntimeRegistry } from "../ports/session-runtime";
import { requireRuntime } from "./require-runtime";

/** Stops one subagent of a session Gravita runs (its completion arrives as an event). */
export class StopAgent {
  constructor(private readonly runtimes: SessionRuntimeRegistry) {}

  async execute(p: { sessionId: string; agentId: string }): Promise<{ ok: true }> {
    await requireRuntime(this.runtimes, p.sessionId).stopAgent(p.agentId);
    return { ok: true };
  }
}
