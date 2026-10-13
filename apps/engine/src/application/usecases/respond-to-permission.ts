import { NotControllableError } from "../../domain/errors";
import type { PermissionDecision, SessionRuntimeRegistry } from "../ports/session-runtime";

export interface PermissionResponse {
  sessionId: string;
  agentId: string;
  requestId: string;
  decision: PermissionDecision;
}

/**
 * Answers a pending permission request through the runtime that controls the session.
 * External sessions have no runtime: their prompt lives in the user's terminal.
 */
export class RespondToPermission {
  constructor(private readonly runtimes: SessionRuntimeRegistry) {}

  async execute(p: PermissionResponse): Promise<{ ok: true }> {
    const runtime = this.runtimes.get(p.sessionId);
    if (!runtime) throw new NotControllableError(p.sessionId);
    await runtime.respondPermission(p.agentId, p.requestId, p.decision);
    return { ok: true };
  }
}
