import type { SquadState } from "@gravita/core";
import { useId } from "react";
import { t } from "@/shared/i18n/i18n";
import { usd } from "@/shared/presenters/money";
import { LineBadge } from "@/shared/ui/ui";
import { cn } from "@/shared/utils";
import type { SquadView } from "../model";

/**
 * Spent of total, in tabular dollars, with a thin meter. Hover or focus shows what each
 * role spent against its own budget. Orange only once the budget waits on the user.
 */
export function BudgetMeter({ squad: q, view }: { squad: SquadState; view: SquadView }) {
  const id = useId();
  const total = q.budgetUsd;
  const spent = q.budget.spentUsd;
  const share = total > 0 ? Math.min(1, spent / total) : 0;
  const exhausted = q.budget.exhausted.includes(`squad:${q.id}`) && Boolean(q.paused);
  const warned = q.budget.warned.includes(`squad:${q.id}`);
  return (
    <div className="group relative flex-none">
      <button
        type="button"
        aria-describedby={`${id}-roles`}
        className="flex flex-col items-end gap-1 rounded-md px-1.5 py-0.5 text-right"
      >
        <span className="tabular text-sm text-ink">
          <span className={cn("font-medium", exhausted && "text-waiting-ink")}>{usd(spent)}</span>
          <span className="text-ink-3"> / {usd(total)}</span>
        </span>
        <span aria-hidden="true" className="block h-1 w-28 overflow-hidden rounded-full bg-panel-2">
          <span
            className={cn("block h-full rounded-full", exhausted ? "bg-waiting" : "bg-ink")}
            style={{ width: `${share * 100}%` }}
          />
        </span>
        <span className="sr-only">
          {t("squad.budget.label", { spent: usd(spent), total: usd(total) })}
        </span>
      </button>
      <div
        id={`${id}-roles`}
        role="tooltip"
        className="invisible absolute top-full right-0 z-20 mt-2 w-72 rounded-xl border border-hairline bg-ground p-3 opacity-0 shadow-float transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
      >
        <p className="mb-2 text-xs font-semibold text-ink-2">
          {warned && !exhausted ? t("squad.budget.warned") : t("squad.budget.byRole")}
        </p>
        <ul className="flex flex-col gap-1.5">
          {view.planner && (
            <li className="flex items-center gap-2 text-sm">
              <LineBadge agentType="planner" size={16} />
              <span className="min-w-0 flex-1 truncate">{t("squad.role.planner")}</span>
              <span className="tabular text-xs text-ink-2">{usd(view.planner.spentUsd)}</span>
            </li>
          )}
          {view.roles.map((r) => {
            const out = q.budget.exhausted.includes(`role:${r.id}`);
            return (
              <li key={r.id} className="flex items-center gap-2 text-sm">
                <LineBadge agentType={r.colorKey} code={r.code} title={r.name} size={16} />
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
                <span className={cn("tabular text-xs", out ? "text-waiting-ink" : "text-ink-2")}>
                  {usd(r.spentUsd)}
                  {r.budgetUsd !== undefined && (
                    <span className="text-ink-3"> / {usd(r.budgetUsd)}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
