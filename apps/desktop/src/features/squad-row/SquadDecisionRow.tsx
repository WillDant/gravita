import { squadPlan } from "@gravita/core";
import { useNavigate } from "@/app/providers";
import { t } from "@/shared/i18n/i18n";
import {
  roleCode,
  roleColorKey,
  roleOf,
  type SquadDecisionItem,
  squadTitle,
} from "@/shared/presenters/squad";
import { Button, LineBadge } from "@/shared/ui/ui";

/** One thing a squad waits on you for, on Home's "Needs you": what, where, and the way in. */
export function SquadDecisionRow({ item }: { item: SquadDecisionItem }) {
  const navigate = useNavigate();
  const { project, squad: q, decision: d } = item;
  const plan = squadPlan(q);
  const task = d.kind === "task" ? plan?.tasks.find((x) => x.id === d.taskId) : undefined;
  const role = task ? roleOf(plan, q.tasks[task.id]?.role ?? task.role) : undefined;
  const open = () =>
    navigate({
      level: "squad",
      projectId: project.id,
      squadId: q.id,
      ...(d.kind === "task" ? { taskId: d.taskId } : {}),
    });

  let what: string;
  let detail: string | undefined;
  let action: string;
  switch (d.kind) {
    case "review":
      what = t("squad.decision.review");
      action = t("squad.decision.reviewAction");
      break;
    case "deliver":
      what = t("squad.decision.deliver");
      action = t("squad.decision.deliverAction");
      break;
    case "paused":
      what = t(`squad.paused.${d.pause}`);
      detail = d.pause === "other" ? d.reason : undefined;
      action = t("squad.decision.resumeAction");
      break;
    case "plannerFailed":
      what = t("squad.decision.plannerFailed");
      detail = d.reason;
      action = t("squad.decision.openAction");
      break;
    case "task":
      what = t(d.status === "failed" ? "squad.decision.taskFailed" : "squad.decision.taskBlocked", {
        task: task?.title ?? d.taskId,
      });
      detail = d.reason;
      action = t("squad.decision.decideAction");
      break;
  }

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-waiting/40 bg-waiting-bg py-3 pr-4 pl-4">
      <button
        type="button"
        onClick={open}
        className="flex min-w-[280px] flex-1 items-center gap-3 text-left"
      >
        <span className="flex size-[34px] flex-none items-center justify-center">
          <LineBadge
            agentType={role ? roleColorKey(role, plan) : "planner"}
            {...(role ? { code: roleCode(role), title: role.name } : {})}
            size={22}
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs text-ink-2">
            {project.name} › {squadTitle(q)}
          </span>
          <span className="block truncate font-medium text-ink">{what}</span>
          {detail && (
            <span className="block truncate text-xs font-medium text-waiting-ink">{detail}</span>
          )}
        </span>
      </button>
      <Button variant="primary" onClick={open}>
        {action}
      </Button>
    </li>
  );
}
