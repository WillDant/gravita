import type { AgentNode, SessionState } from "@gravita/core";
import { Square } from "lucide-react";
import { useState } from "react";
import { t } from "@/shared/i18n/i18n";
import { describeError } from "@/shared/presenters/errors";
import { Button } from "@/shared/ui/ui";
import { useControl } from "@/state/hooks";

/** Stops one agent of a session Gravita runs. Kept on its own row, away from other actions. */
export function StopAgent({ session, agent }: { session: SessionState; agent: AgentNode }) {
  const { stopAgent } = useControl();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const stop = () => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    void stopAgent(session.id, agent.id).then((r) => {
      setBusy(false);
      if (!r.ok) setError(describeError(r.error).text);
    });
  };

  return (
    <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-1 border-t border-hairline px-5 py-3">
      <Button onClick={stop} aria-busy={busy}>
        <Square size={12} aria-hidden="true" className="fill-current" />
        {t("agent.stop")}
      </Button>
      {error && (
        <span role="alert" className="min-w-0 text-xs text-error-ink">
          {error}
        </span>
      )}
    </div>
  );
}
