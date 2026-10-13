import type { SquadState } from "@gravita/core";
import { planShareUsed } from "@gravita/core";
import { useId } from "react";
import { t } from "@/shared/i18n/i18n";
import { usd } from "@/shared/presenters/money";
import { budgetFigure, points } from "@/shared/presenters/planUsage";
import { LineBadge } from "@/shared/ui/ui";
import { cn } from "@/shared/utils";
import { useUsage } from "@/state/hooks";
import type { SquadView } from "../model";

const PROVIDER_NAMES: Record<string, string> = { claude: "Claude", codex: "Codex" };

/**
 * What the squad used of its budget, tabular, with a thin meter: dollars of a USD squad, or
 * points of a plan squad's share ("6 / 20 pts", "measuring…" until the baseline is known).
 * Hover or focus shows the breakdown: each provider's points for a plan squad (other use of
 * the account counts too), and what each role spent. Orange only once the budget waits on
 * the user.
 */
export function BudgetMeter({ squad: q, view }: { squad: SquadState; view: SquadView }) {
  const id = useId();
  const usage = useUsage();
  const figure = budgetFigure(q, usage);
  const plan = q.budgetPlan;
  const exhausted = q.budget.exhausted.includes(`squad:${q.id}`) && Boolean(q.paused);
  const warned = q.budget.warned.includes(`squad:${q.id}`);
  const byProvider = plan ? Object.entries(planShareUsed(q, usage).byProvider) : [];
  return (
    <div className="group relative flex-none">
      <button
        type="button"
        aria-describedby={`${id}-roles`}
        className="flex flex-col items-end gap-1 rounded-md px-1.5 py-0.5 text-right"
      >
        <span className="tabular text-sm text-ink">
          {figure.measuring ? (
            <span className="text-ink-3">{t("squad.budget.measuring")}</span>
          ) : (
            <span className={cn("font-medium", exhausted && "text-waiting-ink")}>
              {figure.spent}
            </span>
          )}
          <span className="text-ink-3"> / {figure.total}</span>
        </span>
        <span aria-hidden="true" className="block h-1 w-28 overflow-hidden rounded-full bg-panel-2">
          <span
            className={cn("block h-full rounded-full", exhausted ? "bg-waiting" : "bg-ink")}
            style={{ width: `${figure.share * 100}%` }}
          />
        </span>
        <span className="sr-only">{figure.label}</span>
      </button>
      <div
        id={`${id}-roles`}
        role="tooltip"
        className="invisible absolute top-full right-0 z-20 mt-2 w-72 rounded-xl border border-hairline bg-ground p-3 opacity-0 shadow-float transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
      >
        {plan && (
          <div className="mb-3 border-b border-hairline pb-3">
            <p className="mb-2 text-xs font-semibold text-ink-2">
              {warned && !exhausted ? t("squad.budget.warnedPlan") : t("squad.budget.byProvider")}
            </p>
            <ul className="flex flex-col gap-1.5">
              {byProvider.map(([provider, used]) => (
                <li key={provider} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {PROVIDER_NAMES[provider] ?? provider}
                  </span>
                  <span className="tabular text-xs text-ink-2">
                    {t("squad.budget.providerPoints", {
                      used: points(used ?? 0),
                      limit: points(plan.maxPercent),
                    })}
                  </span>
                </li>
              ))}
              {byProvider.length === 0 && (
                <li className="text-xs text-ink-3">{t("squad.budget.measuring")}</li>
              )}
            </ul>
            <p className="mt-2 text-xs text-ink-3">{t("squad.budget.accountWide")}</p>
          </div>
        )}
        <p className="mb-2 text-xs font-semibold text-ink-2">
          {plan
            ? t("squad.budget.roleSpend")
            : warned && !exhausted
              ? t("squad.budget.warned")
              : t("squad.budget.byRole")}
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
                  {r.budgetUsd !== undefined && !plan && (
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
