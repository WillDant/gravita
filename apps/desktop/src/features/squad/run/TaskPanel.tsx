import type { SquadState } from "@gravita/core";
import { ExternalLink, X } from "lucide-react";
import { useNavigate } from "@/app/providers";
import { ago, t } from "@/shared/i18n/i18n";
import { Button, LineBadge } from "@/shared/ui/ui";
import { cn } from "@/shared/utils";
import { type SquadView, titleOf } from "../model";
import { StationGlyph } from "../StationGlyph";
import { TaskDecision } from "./TaskDecision";

/**
 * One task's story: what it is for, when it counts as done, what happened on each try
 * (paths outside its role, merge conflicts, red checks), its commits and its session.
 */
export function TaskPanel({
  squad: q,
  view,
  taskId,
  now,
  onClose,
  onSelectTask,
  onSelectRole,
}: {
  squad: SquadState;
  view: SquadView;
  taskId: string;
  now: number;
  onClose: () => void;
  onSelectTask: (taskId: string) => void;
  onSelectRole: (roleId: string) => void;
}) {
  const navigate = useNavigate();
  const x = view.task(taskId);
  if (!x) {
    return (
      <div className="flex flex-col gap-3 px-5 py-4">
        <p className="text-sm text-ink-2">{t("squad.task.missing")}</p>
        <Button onClick={onClose}>{t("agent.close")}</Button>
      </div>
    );
  }
  const { task } = x;
  const role = view.role(x.role);
  const violations = q.violations.filter((v) => v.taskId === taskId);
  const merges = Object.values(q.merges)
    .filter((m) => m.taskId === taskId)
    .sort((a, b) => a.attempt - b.attempt);
  const commits = q.commits.filter((c) => c.taskId === taskId);
  const checks = (view.plan?.checks ?? []).filter((c) => c.when !== "final");
  const stuck = x.status === "blocked" || x.status === "failed";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-start gap-3 border-b border-hairline px-5 pt-4 pb-4">
        <span className="mt-1">
          <StationGlyph status={x.status} size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-md leading-snug font-bold tracking-[-0.01em]">{task.title}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2">
            {role && (
              <button
                type="button"
                onClick={() => onSelectRole(role.id)}
                className="inline-flex items-center gap-1.5 font-medium hover:text-ink"
              >
                <LineBadge agentType={role.colorKey} code={role.code} title={role.name} size={16} />
                {role.name}
              </button>
            )}
            <span
              className={cn(
                "font-semibold",
                x.status === "failed" && "text-error-ink",
                x.status === "blocked" && "text-waiting-ink",
              )}
            >
              {t(`squad.task.status.${x.status}`)}
            </span>
            {x.attempt > 1 && <span>{t("squad.task.attempt", { n: x.attempt })}</span>}
            <span>{t(`squad.size.${task.size}`)}</span>
            {task.foundation && <span>{t("squad.board.foundation")}</span>}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("agent.close")}
          className="rounded-md p-1.5 text-ink-3 hover:bg-panel hover:text-ink"
        >
          <X size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {stuck && (
          <div className="flex flex-col gap-2 border-b border-waiting/30 bg-waiting-bg px-5 py-3.5">
            {x.reason && <p className="text-sm whitespace-pre-line text-ink">{x.reason}</p>}
            <TaskDecision squad={q} view={view} task={x} />
          </div>
        )}

        <div className="flex flex-col gap-5 px-5 py-4">
          <p className="text-base text-ink">{task.plainSummary}</p>

          {x.added && (
            <p className="text-xs text-ink-2">
              {x.added.origin === "bug"
                ? t("squad.task.addedBug")
                : t("squad.task.addedRequest", {
                    role: view.role(x.added.fromRole ?? "")?.name ?? x.added.fromRole ?? "",
                  })}
            </p>
          )}

          <Block title={t("squad.task.acceptance")}>
            <ul className="flex flex-col gap-1 text-sm text-ink-2">
              {task.acceptance.map((a) => (
                <li key={a} className="flex gap-2">
                  <span
                    aria-hidden="true"
                    className="mt-[7px] size-1.5 flex-none rounded-full bg-ink-3"
                  />
                  {a}
                </li>
              ))}
            </ul>
          </Block>

          {task.dependsOn.length > 0 && (
            <Block title={t("squad.task.after")}>
              <ul className="flex flex-col gap-1">
                {task.dependsOn.map((d) => (
                  <li key={d}>
                    <button
                      type="button"
                      onClick={() => onSelectTask(d)}
                      className="inline-flex items-center gap-2 text-sm text-ink-2 hover:text-ink"
                    >
                      <StationGlyph status={view.task(d)?.status ?? "pending"} size={14} />
                      {titleOf(view.plan, d)}
                    </button>
                  </li>
                ))}
              </ul>
            </Block>
          )}

          <Block title={t("squad.task.writes")}>
            <ul className="flex flex-col gap-0.5 font-mono text-xs text-ink-2">
              {task.writes.map((w) => (
                <li key={w} className="break-all">
                  {w}
                </li>
              ))}
            </ul>
          </Block>

          {(violations.length > 0 || merges.length > 0 || (x.reason && !stuck)) && (
            <Block title={t("squad.task.tries")}>
              <ol className="flex flex-col gap-3 text-sm">
                {x.reason && !stuck && (
                  <li className="whitespace-pre-line text-ink-2">{x.reason}</li>
                )}
                {violations.map((v) => (
                  <li key={`v-${v.attempt}-${v.bounce ?? 1}`}>
                    <p className="text-ink">{t("squad.task.violation", { n: v.attempt })}</p>
                    <ul className="mt-1 flex flex-col gap-0.5 font-mono text-xs text-error-ink">
                      {v.paths.map((p) => (
                        <li key={p} className="break-all">
                          {p}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
                {merges.map((m) => (
                  <li key={`m-${m.attempt}`}>
                    <p
                      className={cn(
                        m.state === "conflicted" || m.state === "reverted"
                          ? "text-error-ink"
                          : "text-ink-2",
                      )}
                    >
                      {t(`squad.task.merge.${m.state}`, { n: m.attempt, check: m.checkId ?? "" })}
                    </p>
                    {m.paths && m.paths.length > 0 && (
                      <ul className="mt-1 flex flex-col gap-0.5 font-mono text-xs text-ink-2">
                        {m.paths.map((p) => (
                          <li key={p} className="break-all">
                            {p}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
            </Block>
          )}

          {checks.length > 0 && (
            <Block title={t("squad.task.checks")}>
              <ul className="flex flex-col gap-2">
                {checks.map((c) => {
                  const run = q.checks[c.id];
                  return (
                    <li key={c.id}>
                      <p className="flex items-center gap-2 text-xs">
                        <span
                          aria-hidden="true"
                          className={cn(
                            "size-2 flex-none rounded-full",
                            !run ? "border border-ink-3" : run.ok ? "bg-ok" : "bg-error",
                          )}
                        />
                        <code className="min-w-0 flex-1 truncate font-mono text-ink">
                          {c.argv.join(" ")}
                        </code>
                        <span
                          className={cn(
                            "flex-none",
                            run && !run.ok ? "font-semibold text-error-ink" : "text-ink-3",
                          )}
                        >
                          {!run
                            ? t("squad.check.notRun")
                            : run.ok
                              ? t("squad.check.ok")
                              : t("squad.check.red")}
                        </span>
                      </p>
                      {run && !run.ok && run.outputPreview && (
                        <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-error-bg px-2 py-1.5 font-mono text-[11px] whitespace-pre-wrap text-error-ink">
                          {run.outputPreview}
                        </pre>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Block>
          )}

          {commits.length > 0 && (
            <Block title={t("squad.task.commits")}>
              <ul className="flex flex-col gap-2">
                {commits.map((c) => (
                  <li key={c.sha} className="text-xs">
                    <p className="flex items-center gap-2">
                      <code className="font-mono text-ink">{c.sha.slice(0, 7)}</code>
                      <span className="text-ink-3">
                        {t("squad.deliver.files", { count: c.files.length })}
                      </span>
                      <span className="ml-auto text-ink-3">{ago(c.ts, now)}</span>
                    </p>
                    <ul className="mt-0.5 flex flex-col font-mono text-[11px] text-ink-2">
                      {c.files.slice(0, 8).map((f) => (
                        <li key={f} className="truncate">
                          {f}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </Block>
          )}

          {x.sessionId && (
            <Button
              onClick={() =>
                navigate({
                  level: "session",
                  projectId: q.projectId,
                  sessionId: x.sessionId as string,
                })
              }
              className="self-start"
            >
              <ExternalLink size={14} aria-hidden="true" />
              {t("squad.task.openSession")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-xs font-semibold text-ink-2">{title}</h3>
      {children}
    </section>
  );
}
