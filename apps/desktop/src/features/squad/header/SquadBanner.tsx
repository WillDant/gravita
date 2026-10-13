import type { SquadState } from "@gravita/core";
import { useId, useState } from "react";
import { parseUsd } from "@/features/new-squad/useNewSquad";
import { t } from "@/shared/i18n/i18n";
import { usd } from "@/shared/presenters/money";
import { pauseKind } from "@/shared/presenters/squad";
import { fieldFrame } from "@/shared/ui/form";
import { Button } from "@/shared/ui/ui";
import { cn } from "@/shared/utils";
import { useAppStore } from "@/state/hooks";
import { useSquadAction } from "../useSquadAction";

/** A sensible next ceiling: half as much again, and at least $10 over what's spent. */
export function suggestBudget(q: Pick<SquadState, "budgetUsd" | "budget">): number {
  const next = Math.max(q.budgetUsd * 1.5, q.budget.spentUsd + 10);
  return Math.min(1_000, Math.ceil(next / 5) * 5);
}

/**
 * The line under the header when the squad isn't simply running: paused (and why),
 * stopped, or failed. A pause that waits on the user is orange; one the user chose isn't.
 */
export function SquadBanner({ squad: q }: { squad: SquadState }) {
  const kind = pauseKind(q);
  const resume = useSquadAction(useAppStore((s) => s.resumeSquad));
  const id = useId();
  const [budget, setBudget] = useState(() => String(suggestBudget(q)));
  const [invalid, setInvalid] = useState(false);

  if (q.phase === "stopped") {
    return (
      <div
        role="status"
        className="flex-none border-b border-hairline bg-panel px-6 py-2.5 text-sm text-ink-2"
      >
        {t("squad.banner.stopped")}
      </div>
    );
  }
  if (q.phase === "failed" && q.planStatus === "approved") {
    return (
      <div
        role="alert"
        className="flex-none border-b border-error/30 bg-error-bg px-6 py-2.5 text-sm text-error-ink"
      >
        {t("squad.banner.failed")} {q.phaseReason}
      </div>
    );
  }
  if (!q.paused || !kind) return null;

  const waiting = kind !== "user";
  const raise = () => {
    const usdValue = parseUsd(budget);
    const ok = usdValue > q.budget.spentUsd && usdValue <= 1_000;
    setInvalid(!ok);
    if (ok) void resume.run({ squadId: q.id, budgetUsd: Math.round(usdValue * 100) / 100 });
  };

  return (
    <div
      role="status"
      className={cn(
        "flex flex-none flex-wrap items-center gap-x-4 gap-y-2 border-b px-6 py-2.5 text-sm",
        waiting
          ? "border-waiting/30 bg-waiting-bg text-waiting-ink"
          : "border-hairline bg-panel text-ink-2",
      )}
    >
      <p className="min-w-0 flex-1">
        <span className="font-semibold">{t(`squad.paused.${kind}`)}</span>
        {kind === "budget" && (
          <span>
            {" "}
            {t("squad.banner.spent", { spent: usd(q.budget.spentUsd), total: usd(q.budgetUsd) })}
          </span>
        )}
        {kind === "other" && (
          <span className="block text-xs whitespace-pre-line">{q.paused.reason}</span>
        )}
      </p>
      {kind === "budget" ? (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            raise();
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <label htmlFor={`${id}-budget`} className="text-xs font-semibold">
            {t("squad.banner.newBudget")}
          </label>
          <div className={cn(fieldFrame, "flex w-28 items-center pl-2.5")}>
            <span aria-hidden="true" className="tabular text-sm text-ink-3">
              $
            </span>
            <input
              id={`${id}-budget`}
              inputMode="decimal"
              value={budget}
              onChange={(e) => {
                setBudget(e.target.value);
                setInvalid(false);
              }}
              aria-invalid={invalid}
              className="tabular h-8 w-full bg-transparent pr-2 pl-1 text-sm text-ink outline-none focus-visible:outline-none"
            />
          </div>
          <Button type="submit" variant="primary" aria-busy={resume.busy}>
            {t("squad.banner.resumeWithBudget")}
          </Button>
          {invalid && (
            <span role="alert" className="w-full text-xs text-error-ink">
              {t("squad.banner.budgetTooLow", { spent: usd(q.budget.spentUsd) })}
            </span>
          )}
        </form>
      ) : (
        <Button
          variant={waiting ? "primary" : "secondary"}
          aria-busy={resume.busy}
          onClick={() => void resume.run({ squadId: q.id })}
        >
          {t("squad.resume")}
        </Button>
      )}
      {resume.error && (
        <span role="alert" className="w-full text-xs text-error-ink">
          {resume.error}
        </span>
      )}
    </div>
  );
}
