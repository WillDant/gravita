import {
  type AgentNode,
  effectiveLifecycle,
  type SessionState,
  type SquadState,
  toPersona,
} from "@gravita/core";
import { agentColor } from "@gravita/orbs";
import { ArrowRight } from "lucide-react";
import { Orb } from "@/features/agents/Orb";
import { PermissionActions } from "@/features/permissions/PermissionActions";
import { QuestionCard } from "@/features/questions/QuestionCard";
import { firstQuestion } from "@/features/questions/questions";
import { ago, t } from "@/shared/i18n/i18n";
import { agentName, permissionSummary } from "@/shared/presenters/agent";
import { usd } from "@/shared/presenters/money";
import { ProviderMark } from "@/shared/ui/ProviderMark";
import { LineBadge } from "@/shared/ui/ui";
import { cn } from "@/shared/utils";
import type { RoleView, SquadView, TaskView } from "../model";
import { RESTING, sessionHead } from "../personas";
import { StationGlyph } from "../StationGlyph";
import { TaskDecision } from "./TaskDecision";

/** Agents in the squad's sessions that wait on the user, with their session and role. */
function waitingAgents(view: SquadView, now: number) {
  const out: { role: RoleView; session: SessionState; agent: AgentNode }[] = [];
  for (const role of view.roles) {
    const s = role.session;
    if (!s) continue;
    for (const a of Object.values(s.agents))
      if (effectiveLifecycle(a, s, now) === "waiting_user")
        out.push({ role, session: s, agent: a });
  }
  return out;
}

/**
 * The right column of a running squad: what waits on the user first (stuck tasks, the
 * roles' own questions and permissions), then what each role is doing, then what the
 * roles said to each other.
 */
export function SquadColumn({
  squad: q,
  view,
  now,
  onSelectTask,
  onSelectRole,
}: {
  squad: SquadState;
  view: SquadView;
  now: number;
  onSelectTask: (taskId: string) => void;
  onSelectRole: (roleId: string) => void;
}) {
  const stuck = view.tasks.filter((x) => x.status === "blocked" || x.status === "failed");
  const asks = waitingAgents(view, now);
  const requests = Object.values(q.changeRequests).sort((a, b) =>
    (b.openedTs ?? "").localeCompare(a.openedTs ?? ""),
  );
  const talk = [
    ...requests.map((r) => ({ kind: "request" as const, ts: r.openedTs ?? "", r })),
    ...q.notes.map((n) => ({ kind: "note" as const, ts: n.ts, n })),
  ].sort((a, b) => b.ts.localeCompare(a.ts));
  const roleName = (id?: string) => (id ? (view.role(id)?.name ?? id) : t("squad.notes.everyone"));
  const badge = (id: string) => {
    const r = view.role(id);
    return { agentType: r?.colorKey ?? id, ...(r ? { code: r.code, title: r.name } : {}) };
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {stuck.length + asks.length > 0 && (
        <section
          aria-labelledby="squad-needs-you"
          className="border-b border-waiting/30 bg-waiting-bg px-3 pt-3.5 pb-3"
        >
          <h2 id="squad-needs-you" className="px-2 pb-2 text-sm font-semibold text-waiting-ink">
            {t("squad.column.needsYou", { count: stuck.length + asks.length })}
          </h2>
          <ul className="flex flex-col gap-3">
            {stuck.map((x) => (
              <StuckTask
                key={x.task.id}
                squad={q}
                view={view}
                task={x}
                onOpen={() => onSelectTask(x.task.id)}
              />
            ))}
            {asks.map(({ role, session, agent }) => {
              const question = firstQuestion(agent);
              const persona = toPersona(agent, session, now);
              return (
                <li key={`${session.id}:${agent.id}`} className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => onSelectRole(role.id)}
                    className="flex items-start gap-2.5 rounded-lg px-2 py-1 text-left hover:bg-waiting/10"
                  >
                    <Orb
                      color={agentColor(role.colorKey)}
                      persona={persona}
                      size={28}
                      seed={`${session.id}:${agent.id}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm leading-snug text-ink">
                        <span className="font-semibold">
                          {agent.id === "main" ? role.name : `${role.name} › ${agentName(agent)}`}
                        </span>{" "}
                        {t(persona.label.key, persona.label.params)}
                      </span>
                      {!question && permissionSummary(agent) && (
                        <span className="mt-0.5 block truncate font-mono text-xs text-waiting-ink">
                          {permissionSummary(agent)}
                        </span>
                      )}
                    </span>
                  </button>
                  {question ? (
                    <QuestionCard
                      session={session}
                      agent={agent}
                      pending={question}
                      className="px-2"
                    />
                  ) : (
                    <PermissionActions session={session} agent={agent} className="pl-[46px]" />
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-labelledby="squad-happening" className="px-3 pt-4 pb-3">
        <h2 id="squad-happening" className="px-2 pb-2 text-sm font-semibold">
          {t("session.happening")}
        </h2>
        <ul className="flex flex-col gap-1">
          {view.roles.map((r) => (
            <RoleRow
              key={r.id}
              role={r}
              view={view}
              now={now}
              onSelect={() => onSelectRole(r.id)}
            />
          ))}
        </ul>
      </section>

      <section aria-labelledby="squad-talk" className="border-t border-hairline px-5 pt-4 pb-6">
        <h2 id="squad-talk" className="text-sm font-semibold">
          {t("squad.notes.title")}
        </h2>
        {talk.length === 0 ? (
          <p className="mt-1 text-sm text-ink-3">{t("squad.notes.empty")}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-3">
            {talk.map((item) => {
              const from = item.kind === "request" ? item.r.fromRole : item.n.fromRole;
              const to = item.kind === "request" ? item.r.toRole : item.n.toRole;
              const text = item.kind === "request" ? item.r.text : item.n.text;
              return (
                <li
                  key={item.kind === "request" ? item.r.requestId : item.n.noteId}
                  className="flex flex-col gap-1"
                >
                  <p className="flex items-center gap-1.5 text-xs text-ink-2">
                    <LineBadge {...badge(from)} size={16} />
                    <span className="font-semibold text-ink">{roleName(from)}</span>
                    <ArrowRight size={12} aria-label={t("squad.notes.to")} className="text-ink-3" />
                    {to && <LineBadge {...badge(to)} size={16} />}
                    <span className="font-semibold text-ink">{roleName(to)}</span>
                    <span className="ml-auto text-ink-3">
                      {item.kind === "request" ? (
                        <span
                          className={cn(
                            "rounded-full px-1.5 py-px font-medium",
                            item.r.state === "open" ? "bg-panel text-ink" : "text-ink-3",
                          )}
                        >
                          {t(`squad.request.${item.r.state}`)}
                        </span>
                      ) : (
                        t("squad.notes.note")
                      )}
                    </span>
                  </p>
                  <p className="pl-[22px] text-sm text-ink-2">{text}</p>
                  {item.kind === "request" && item.r.taskId && (
                    <button
                      type="button"
                      onClick={() => onSelectTask(item.r.taskId as string)}
                      className="self-start pl-[22px] text-xs font-medium text-ink-2 underline decoration-hairline-strong underline-offset-3 hover:text-ink"
                    >
                      {t("squad.request.task", {
                        task: view.task(item.r.taskId)?.task.title ?? item.r.taskId,
                      })}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function StuckTask({
  squad,
  view,
  task,
  onOpen,
}: {
  squad: SquadState;
  view: SquadView;
  task: TaskView;
  onOpen: () => void;
}) {
  const role = view.role(task.role);
  return (
    <li className="flex flex-col gap-2 px-2">
      <button type="button" onClick={onOpen} className="flex items-start gap-2.5 text-left">
        <span className="mt-0.5">
          <StationGlyph status={task.status} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-sm text-ink">
            <span className="truncate font-semibold">{task.task.title}</span>
            <span
              className={cn(
                "flex-none text-xs font-medium",
                task.status === "failed" ? "text-error-ink" : "text-waiting-ink",
              )}
            >
              {t(`squad.task.status.${task.status}`)}
            </span>
          </span>
          {role && (
            <span className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-2">
              <LineBadge agentType={role.colorKey} code={role.code} title={role.name} size={14} />
              {role.name}
              <ProviderMark provider={role.provider} compact />
            </span>
          )}
          {task.reason && (
            <span className="mt-1 line-clamp-3 block text-xs whitespace-pre-line text-ink-2">
              {task.reason}
            </span>
          )}
        </span>
      </button>
      <TaskDecision squad={squad} view={view} task={task} compact />
    </li>
  );
}

/** One role: its orb, what it is doing, its task, its spend. */
function RoleRow({
  role,
  view,
  now,
  onSelect,
}: {
  role: RoleView;
  view: SquadView;
  now: number;
  onSelect: () => void;
}) {
  const head = sessionHead(role.session, now);
  const mine = view.tasks.filter((x) => x.role === role.id);
  const current =
    mine.find((x) => x.status === "running" || x.status === "review") ??
    mine.find((x) => x.status === "blocked" || x.status === "failed");
  const next = mine.find((x) => x.status === "pending" || x.status === "ready");
  const done = mine.filter((x) => x.status === "done" || x.status === "skipped").length;
  const live = head?.live ?? false;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-panel"
      >
        <Orb
          color={agentColor(role.colorKey)}
          persona={head && live ? head.persona : RESTING}
          size={live ? 32 : 26}
          glyph={live}
          motion="ambient"
          seed={`${role.id}`}
        />
        <span className="min-w-0 flex-1">
          <span className={cn("block text-sm leading-snug", live ? "text-ink" : "text-ink-2")}>
            <span className="font-semibold">{role.name}</span>{" "}
            {live && head
              ? head.label
              : current
                ? t(`squad.task.status.${current.status}`)
                : next
                  ? t("squad.role.waitingTurn")
                  : mine.length > 0
                    ? t("squad.role.finished")
                    : t("squad.role.noTasks")}
          </span>
          <span className="mt-0.5 flex items-center gap-2 text-xs text-ink-3">
            <span className="min-w-0 flex-1 truncate">
              {current
                ? current.task.title
                : next
                  ? t("squad.role.next", { task: next.task.title })
                  : role.session
                    ? ago(role.session.lastEventTs, now)
                    : ""}
            </span>
            <span className="flex-none tabular-nums">
              {t("squad.role.tasksDone", { done, total: mine.length })}
            </span>
            <span
              className="tabular flex-none text-ink-2"
              title={view.apiEquivalent ? t("usage.apiEquivalent") : undefined}
            >
              {usd(role.spentUsd)}
              {role.budgetUsd !== undefined && (
                <span className="text-ink-3">/{usd(role.budgetUsd, 0)}</span>
              )}
            </span>
          </span>
        </span>
      </button>
    </li>
  );
}
