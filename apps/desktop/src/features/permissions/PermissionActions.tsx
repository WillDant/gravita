import type { AgentNode, SessionState } from "@gravita/core";
import { Terminal } from "lucide-react";
import { t } from "@/shared/i18n/i18n";
import { Button } from "@/shared/ui/ui";
import { cn } from "@/shared/utils";
import { usePermissionActions } from "./usePermissionActions";

/**
 * Allow / Deny for a waiting agent. Sessions Gravita doesn't control can't be answered
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
  const { requestId, controllable, busy, failed, answer } = usePermissionActions(session, agent);
  if (!requestId) return null;

  if (!controllable) {
    return (
      <p className={cn("flex items-center gap-1.5 text-xs text-waiting-ink", className)}>
        <Terminal size={13} aria-hidden="true" />
        {t("action.answerInTerminal")}
      </p>
    );
  }

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
