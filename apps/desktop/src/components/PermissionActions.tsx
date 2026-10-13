import type { AgentNode, SessionState } from "@gravita/core";
import { Terminal } from "lucide-react";
import { useState } from "react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { respondPermission } from "@/store";
import { Button } from "./ui";

/** What a waiting agent asks for, in one line: "Bash · pnpm add jose". */
export function permissionSummary(agent: AgentNode): string | undefined {
  const req = Object.values(agent.permissions ?? {})[0];
  return req ? `${req.toolName} · ${req.inputPreview}` : undefined;
}

/**
 * Allow / Deny for a waiting agent. Sessions started outside Gravita can't be answered
 * from here (their prompt lives in the user's terminal), so they get a pointer instead.
 */
export function PermissionActions({
  session,
  agent,
  className,
}: {
  session: SessionState;
  agent: AgentNode;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const requestId = agent.pendingPermissions[0];
  if (!requestId) return null;

  if (session.kind === "external") {
    return (
      <p className={cn("flex items-center gap-1.5 text-xs text-waiting-ink", className)}>
        <Terminal size={13} aria-hidden="true" />
        {t("action.answerInTerminal")}
      </p>
    );
  }

  const answer = (decision: "allow" | "deny") => {
    setBusy(true);
    setFailed(false);
    respondPermission({ sessionId: session.id, agentId: agent.id, requestId, decision })
      .catch(() => setFailed(true))
      .finally(() => setBusy(false));
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Button variant="primary" aria-busy={busy} onClick={() => answer("allow")}>
        {t("action.allow")}
      </Button>
      <Button aria-busy={busy} onClick={() => answer("deny")}>
        {t("action.deny")}
      </Button>
      {failed && (
        <span role="alert" className="text-xs text-error-ink">
          {t("action.failed")}
        </span>
      )}
    </div>
  );
}
