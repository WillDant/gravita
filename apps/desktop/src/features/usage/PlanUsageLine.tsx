import type { AgentProvider } from "@gravita/protocol/constants";
import { t } from "@/shared/i18n/i18n";
import { nearLimit, planWindows, windowLine } from "@/shared/presenters/planUsage";
import { cn } from "@/shared/utils";
import { useAccountPlan, useNow, useUsage } from "@/state/hooks";

/**
 * One quiet line of a provider's plan usage: "Claude plan · 5-hour: 34% used · resets 2:00
 * PM · Weekly: 61% used · resets Fri 9:00 AM". A window the provider marks as close to (or
 * at) its limit turns orange and says so: that waits on the user. Nothing shows until a
 * reading arrives, nor for an account that pays per token.
 */
export function PlanUsageLine({ provider }: { provider: AgentProvider }) {
  const usage = useUsage();
  const now = useNow();
  const plan = useAccountPlan(provider);
  const readings = planWindows(usage, provider);
  if (!readings.length || plan === "api") return null;
  return (
    <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-ink-3">
      <span className="font-semibold text-ink-2">{t(`usage.plan.${provider}`)}</span>
      {readings.map((u) => (
        <span
          key={u.window}
          className={cn("tabular", nearLimit(u) && "font-medium text-waiting-ink")}
        >
          {windowLine(u, now)}
          {nearLimit(u) && ` · ${t(u.status === "rejected" ? "usage.atLimit" : "usage.nearLimit")}`}
        </span>
      ))}
    </p>
  );
}

/** Every provider's plan usage line, under Home's title (nothing while none is known). */
export function PlanUsage({
  providers,
  className,
}: {
  providers: readonly AgentProvider[];
  className?: string;
}) {
  const usage = useUsage();
  const shown = providers.filter((p) => planWindows(usage, p).length > 0);
  if (!shown.length) return null;
  return (
    <div
      aria-label={t("usage.title")}
      role="group"
      className={cn("flex flex-col gap-1", className)}
    >
      {shown.map((p) => (
        <PlanUsageLine key={p} provider={p} />
      ))}
    </div>
  );
}
