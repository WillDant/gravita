import type { SquadState } from "@gravita/core";
import { Pause, Play, Square } from "lucide-react";
import { useState } from "react";
import { t } from "@/shared/i18n/i18n";
import { pauseKind } from "@/shared/presenters/squad";
import { Button } from "@/shared/ui/ui";
import { useAppStore } from "@/state/hooks";
import { useSquadAction } from "../useSquadAction";

/** Phases the engine can pause and resume (it runs sessions in them). */
const PAUSABLE = new Set(["planning", "foundation", "build", "verify"]);

/**
 * Pause or resume, and Stop behind one confirmation: stopping ends every role session
 * and can't be undone (the branches stay).
 */
export function SquadControls({ squad: q }: { squad: SquadState }) {
  const pause = useSquadAction(useAppStore((s) => s.pauseSquad));
  const resume = useSquadAction(useAppStore((s) => s.resumeSquad));
  const stop = useSquadAction(useAppStore((s) => s.stopSquad));
  const [confirming, setConfirming] = useState(false);
  const stoppable = q.phase !== "done" && q.phase !== "stopped" && !q.delivered;
  if (!stoppable) return null;
  const error = pause.error ?? resume.error ?? stop.error;

  if (confirming) {
    return (
      <div
        role="group"
        aria-label={t("squad.stop.confirmTitle")}
        className="flex items-center gap-2"
      >
        <span className="max-w-[24ch] text-xs text-ink-2">{t("squad.stop.confirm")}</span>
        <Button
          variant="primary"
          aria-busy={stop.busy}
          onClick={() => void stop.run(q.id).then((ok) => ok && setConfirming(false))}
        >
          {t("squad.stop.yes")}
        </Button>
        <Button variant="ghost" onClick={() => setConfirming(false)}>
          {t("squad.stop.no")}
        </Button>
        {stop.error && (
          <span role="alert" className="text-xs text-error-ink">
            {stop.error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {error && (
        <span role="alert" className="max-w-[28ch] text-xs text-error-ink">
          {error}
        </span>
      )}
      {PAUSABLE.has(q.phase) &&
        // A squad out of budget resumes from the banner, with a higher budget.
        pauseKind(q) !== "budget" &&
        (q.paused ? (
          <Button aria-busy={resume.busy} onClick={() => void resume.run({ squadId: q.id })}>
            <Play size={14} aria-hidden="true" />
            {t("squad.resume")}
          </Button>
        ) : (
          <Button aria-busy={pause.busy} onClick={() => void pause.run(q.id)}>
            <Pause size={14} aria-hidden="true" />
            {t("squad.pause")}
          </Button>
        ))}
      <Button variant="ghost" onClick={() => setConfirming(true)}>
        <Square size={12} aria-hidden="true" className="fill-current" />
        {t("squad.stop")}
      </Button>
    </div>
  );
}
