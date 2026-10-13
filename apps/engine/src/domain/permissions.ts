import type { SessionState } from "@gravita/core";

/** True while `requestId` still waits for an answer from `agentId` of the session. */
export function isPermissionPending(
  session: Pick<SessionState, "agents"> | undefined,
  agentId: string,
  requestId: string,
): boolean {
  return session?.agents[agentId]?.pendingPermissions.includes(requestId) ?? false;
}
