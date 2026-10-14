import type { SquadState } from "@gravita/core";
import { MAIN_AGENT } from "@gravita/protocol/ids";
import { ExternalLink, X } from "lucide-react";
import { useEffect } from "react";
import { useNavigate } from "@/app/providers";
import { AgentPanel } from "@/features/session/agent-panel/AgentPanel";
import { t } from "@/shared/i18n/i18n";
import { usd } from "@/shared/presenters/money";
import { LineBadge } from "@/shared/ui/ui";
import { cn } from "@/shared/utils";
import { useAppStore, useSessionEvents } from "@/state/hooks";
import type { SquadView } from "../model";
import { StationGlyph } from "../StationGlyph";

/** One role: what it owns, what it spent against its budget, its tasks, and its agent now. */
export function RolePanel({
  squad: q,
  view,
  roleId,
  now,
  onClose,
  onSelectTask,
}: {
  squad: SquadState;
  view: SquadView;
  roleId: string;
  now: number;
  onClose: () => void;
  onSelectTask: (taskId: string) => void;
}) {
  const navigate = useNavigate();
  const role = view.role(roleId);
  const load = useAppStore((s) => s.loadSession);
  const sessionId = role?.sessionId;
  useEffect(() => {
    if (sessionId) load(sessionId);
  }, [sessionId, load]);
  const events = useSessionEvents(sessionId ?? "");
  if (!role) return null;
  const session = role.session;
  const main = session?.agents[MAIN_AGENT];
  const mine = view.tasks.filter((x) => x.role === role.id);
  const share = role.budgetUsd ? Math.min(1, role.spentUsd / role.budgetUsd) : undefined;
  const out = q.budget.exhausted.includes(`role:${role.id}`);
  const openSession = (agentId?: string) =>
    session &&
    navigate({
      level: "session",
      projectId: q.projectId,
      sessionId: session.id,
      ...(agentId ? { agentId } : {}),
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none flex-col gap-2.5 border-b border-hairline px-5 pt-4 pb-3.5">
        <div className="flex items-center gap-2.5">
          <LineBadge agentType={role.colorKey} code={role.code} title={role.name} size={22} />
          <h2 className="min-w-0 flex-1 truncate text-md font-bold tracking-[-0.01em]">
            {role.name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("agent.close")}
            className="rounded-md p-1.5 text-ink-3 hover:bg-panel hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-ink-3">
            {q.budgetPlan ? t("usage.apiEquivalent") : t("squad.role.spent")}
          </span>
          <span className={cn("tabular", out ? "text-waiting-ink" : "text-ink")}>
            {usd(role.spentUsd)}
            {role.budgetUsd !== undefined && (
              <span className="text-ink-3"> / {usd(role.budgetUsd)}</span>
            )}
          </span>
          {share !== undefined && (
            <span aria-hidden="true" className="h-1 w-16 overflow-hidden rounded-full bg-panel-2">
              <span
                className={cn("block h-full rounded-full", out ? "bg-waiting" : "bg-ink")}
                style={{ width: `${share * 100}%` }}
              />
            </span>
          )}
        </div>
        <ul aria-label={t("squad.board.owns")} className="flex flex-wrap gap-1">
          {role.owns.map((o) => (
            <li
              key={o}
              className="rounded-md bg-panel px-1.5 py-0.5 font-mono text-[11px] text-ink-2"
            >
              {o}
            </li>
          ))}
        </ul>
        <ol className="flex flex-col">
          {mine.map((x) => (
            <li key={x.task.id}>
              <button
                type="button"
                onClick={() => onSelectTask(x.task.id)}
                className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-sm text-ink-2 hover:bg-panel hover:text-ink"
              >
                <StationGlyph status={x.status} size={14} />
                <span className="min-w-0 flex-1 truncate">{x.task.title}</span>
                <span className="flex-none text-xs text-ink-3">
                  {t(`squad.task.status.${x.status}`)}
                </span>
              </button>
            </li>
          ))}
        </ol>
        {session && (
          <button
            type="button"
            onClick={() => openSession()}
            className="inline-flex items-center gap-1.5 self-start text-xs font-medium text-ink-2 hover:text-ink"
          >
            <ExternalLink size={12} aria-hidden="true" />
            {t("squad.task.openSession")}
          </button>
        )}
      </div>
      {session && main ? (
        <AgentPanel
          session={session}
          agent={main}
          events={events}
          now={now}
          onSelect={(agentId) => openSession(agentId)}
        />
      ) : (
        <p className="px-5 py-4 text-sm text-ink-3">{t("squad.role.noSession")}</p>
      )}
    </div>
  );
}
