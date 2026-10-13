import { type SessionState, type SquadState, squadPlan, toPersona } from "@gravita/core";
import { agentColor } from "@gravita/orbs";
import { MAIN_AGENT } from "@gravita/protocol/ids";
import { Orb } from "@/features/agents/Orb";
import { ago, t } from "@/shared/i18n/i18n";
import { usd } from "@/shared/presenters/money";
import {
  roleCode,
  roleColorKey,
  squadActive,
  squadDecisions,
  squadDone,
  squadTitle,
} from "@/shared/presenters/squad";
import { LineBadge } from "@/shared/ui/ui";
import { cn } from "@/shared/utils";

/** A squad in its project's list: one row for the whole team, opening the squad's screen. */
export function SquadRow({
  squad: q,
  sessions,
  lastEventTs,
  now,
  onOpen,
}: {
  squad: SquadState;
  sessions: SessionState[];
  lastEventTs: string;
  now: number;
  onOpen: () => void;
}) {
  const plan = squadPlan(q);
  const roles = plan?.roles.filter((r) => r.kind !== "planner") ?? [];
  const { done, total } = squadDone(q);
  const waiting = squadDecisions(q).length > 0;
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const active = squadActive(q);
  return (
    <tr
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
      }}
      className="cursor-pointer transition-colors hover:bg-panel focus-visible:bg-panel"
    >
      <td className="border-b border-hairline py-3 pl-3">
        <span className="block truncate font-medium">{squadTitle(q)}</span>
        <span className="mt-0.5 block text-xs text-ink-3">
          {t("kind.squad")}
          {roles.length > 0 && ` · ${t("squad.roles", { count: roles.length })}`}
        </span>
      </td>
      <td className="border-b border-hairline py-2">
        <span className="flex items-center gap-1">
          {roles.length === 0 && <LineBadge agentType="planner" size={18} />}
          {roles.slice(0, 6).map((r) => {
            const sid = q.roles[r.id]?.currentSessionId;
            const s = sid ? byId.get(sid) : undefined;
            const main = s?.agents[MAIN_AGENT];
            const key = roleColorKey(r, plan);
            return main && s && active ? (
              <span key={r.id} title={r.name} className="inline-flex">
                <Orb
                  color={agentColor(key)}
                  persona={toPersona(main, s, now)}
                  size={22}
                  glyph={false}
                  motion="ambient"
                  seed={`${q.id}:${r.id}`}
                />
              </span>
            ) : (
              <LineBadge key={r.id} agentType={key} code={roleCode(r)} title={r.name} size={18} />
            );
          })}
        </span>
      </td>
      <td className="border-b border-hairline py-3">
        <span
          className={cn(
            "inline-flex items-center gap-2 font-medium",
            waiting ? "text-waiting-ink" : active ? "text-ink" : "text-ink-3",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "size-2 flex-none rounded-full",
              waiting
                ? "bg-waiting"
                : q.phase === "failed"
                  ? "bg-error"
                  : active
                    ? "bg-ok"
                    : "border border-ink-3",
            )}
          />
          {waiting ? t("status.waiting") : t(`squad.phase.${q.phase}`)}
        </span>
        {total > 0 && (
          <span className="mt-0.5 block text-xs text-ink-3 tabular-nums">
            {t("squad.progress", { done, total })}
          </span>
        )}
      </td>
      <td className="border-b border-hairline py-3 text-right text-ink-2 tabular">
        {usd(q.budget.spentUsd)}
      </td>
      <td className="border-b border-hairline py-3 pr-3 text-right text-xs text-ink-3">
        {ago(lastEventTs, now)}
      </td>
    </tr>
  );
}
