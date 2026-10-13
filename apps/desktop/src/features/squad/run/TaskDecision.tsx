import { modelFamily, outsideOwnership, type SquadState } from "@gravita/core";
import { useState } from "react";
import { t } from "@/shared/i18n/i18n";
import { roleCode, roleColorKey } from "@/shared/presenters/squad";
import { Button, LineBadge } from "@/shared/ui/ui";
import { cn } from "@/shared/utils";
import { useAppStore } from "@/state/hooks";
import type { SquadView, TaskView } from "../model";
import { useSquadAction } from "../useSquadAction";

/** The model a stuck task can retry with, when the role doesn't use it already. */
export function strongerModel(q: SquadState, view: SquadView, task: TaskView): string | undefined {
  const role = view.plan?.roles.find((r) => r.id === task.role);
  const current = role?.model ?? q.models.roles;
  return modelFamily(current) === "opus" ? undefined : "opus";
}

/**
 * What to do with a task that waits on the user: retry it (maybe with a stronger model),
 * give it to a role that owns its paths, or skip it.
 */
export function TaskDecision({
  squad: q,
  view,
  task,
  compact,
}: {
  squad: SquadState;
  view: SquadView;
  task: TaskView;
  compact?: boolean;
}) {
  const retry = useSquadAction(useAppStore((s) => s.retryTask));
  const skip = useSquadAction(useAppStore((s) => s.skipTask));
  const reassign = useSquadAction(useAppStore((s) => s.reassignTask));
  const [mode, setMode] = useState<"none" | "reassign" | "skip">("none");
  const stronger = strongerModel(q, view, task);
  const plan = view.plan;
  const options = plan
    ? plan.roles
        .filter((r) => r.kind !== "planner" && r.id !== task.role)
        .map((r) => ({ role: r, outside: outsideOwnership(plan, r.id, task.task.writes) }))
    : [];
  const fitting = options.filter((o) => o.outside.length === 0);
  const error = retry.error ?? skip.error ?? reassign.error;
  const id = task.task.id;

  return (
    <div className={cn("flex flex-col gap-2", compact && "pl-[26px]")}>
      <div className="flex flex-wrap gap-1.5">
        <Button variant="primary" aria-busy={retry.busy} onClick={() => void retry.run(q.id, id)}>
          {t("squad.decide.retry")}
        </Button>
        {stronger && (
          <Button aria-busy={retry.busy} onClick={() => void retry.run(q.id, id, stronger)}>
            {t("squad.decide.retryStronger", { model: t(`newSquad.model.${stronger}`) })}
          </Button>
        )}
      </div>
      <div className="-ml-3 flex flex-wrap gap-1">
        <Button
          variant="ghost"
          aria-expanded={mode === "reassign"}
          onClick={() => setMode(mode === "reassign" ? "none" : "reassign")}
        >
          {t("squad.decide.reassign")}
        </Button>
        <Button
          variant="ghost"
          aria-expanded={mode === "skip"}
          onClick={() => setMode(mode === "skip" ? "none" : "skip")}
        >
          {t("squad.decide.skip")}
        </Button>
      </div>
      {mode === "reassign" && (
        <div className="rounded-lg border border-hairline bg-ground p-2.5">
          {fitting.length === 0 ? (
            <p className="text-xs text-ink-2">
              {t("squad.decide.noRole")}{" "}
              <span className="font-mono text-[11px]">{task.task.writes.join(", ")}</span>
            </p>
          ) : (
            <>
              <p className="mb-1.5 text-xs font-semibold text-ink-2">{t("squad.decide.giveTo")}</p>
              <div className="flex flex-wrap gap-1.5">
                {fitting.map(({ role }) => (
                  <button
                    key={role.id}
                    type="button"
                    aria-busy={reassign.busy}
                    onClick={() =>
                      void reassign.run(q.id, id, role.id).then((ok) => ok && setMode("none"))
                    }
                    className="inline-flex h-7 items-center gap-1.5 rounded-full border border-hairline-strong bg-ground pr-2.5 pl-1 text-xs font-medium text-ink transition-colors hover:bg-panel"
                  >
                    <LineBadge
                      agentType={roleColorKey(role, plan)}
                      code={roleCode(role)}
                      size={18}
                    />
                    {role.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {mode === "skip" && (
        <div className="rounded-lg border border-hairline bg-ground p-2.5">
          <p className="text-xs text-ink-2">{t("squad.decide.skipConfirm")}</p>
          <div className="mt-2 flex gap-2">
            <Button
              variant="primary"
              aria-busy={skip.busy}
              onClick={() => void skip.run(q.id, id).then((ok) => ok && setMode("none"))}
            >
              {t("squad.decide.skipYes")}
            </Button>
            <Button variant="ghost" onClick={() => setMode("none")}>
              {t("newSession.cancel")}
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-error-ink">
          {error}
        </p>
      )}
    </div>
  );
}
