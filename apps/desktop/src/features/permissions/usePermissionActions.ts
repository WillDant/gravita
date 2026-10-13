import type { AgentNode, SessionState } from "@gravita/core";
import { useState } from "react";
import { useAppStore } from "@/state/hooks";

export type Decision = "allow" | "deny";

export interface PermissionActionsModel {
  /** The request to answer, if the agent has one pending. */
  requestId?: string;
  /** Gravita runs this session and can answer it; otherwise it's answered in the terminal. */
  controllable: boolean;
  busy: boolean;
  failed: boolean;
  answer: (decision: Decision) => void;
}

/** Allow / Deny for an agent's first pending permission request, through the engine. */
export function usePermissionActions(
  session: SessionState,
  agent: AgentNode,
): PermissionActionsModel {
  const respond = useAppStore((s) => s.respondPermission);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const requestId = agent.pendingPermissions[0];

  const answer = (decision: Decision) => {
    if (!requestId) return;
    setBusy(true);
    setFailed(false);
    respond({ sessionId: session.id, agentId: agent.id, requestId, decision })
      .catch(() => setFailed(true))
      .finally(() => setBusy(false));
  };

  return { requestId, controllable: session.controllable, busy, failed, answer };
}
