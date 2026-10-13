import type { TaskStatus } from "@gravita/protocol";
import { t } from "@/shared/i18n/i18n";
import { LineBadge } from "@/shared/ui/ui";
import { cn } from "@/shared/utils";
import { type SquadView, type TaskView, titleOf } from "../model";
import { StationGlyph } from "../StationGlyph";

const GROUPS: { key: string; statuses: readonly TaskStatus[] }[] = [
  { key: "waiting", statuses: ["blocked", "failed"] },
  { key: "running", statuses: ["running", "review"] },
  { key: "next", statuses: ["ready", "pending"] },
  { key: "done", statuses: ["done"] },
  { key: "skipped", statuses: ["skipped"] },
];

/** Every task in a compact list, grouped by where it stands; the map in words. */
export function TasksLens({
  view,
  selectedTaskId,
  onSelectTask,
}: {
  view: SquadView;
  selectedTaskId?: string;
  onSelectTask: (taskId: string) => void;
}) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[880px] flex-col gap-6 px-6 py-5">
        {GROUPS.map((g) => {
          const items = view.tasks.filter((x) => g.statuses.includes(x.status));
          if (items.length === 0) return null;
          return (
            <section key={g.key} aria-labelledby={`tasks-${g.key}`}>
              <h2
                id={`tasks-${g.key}`}
                className={cn(
                  "mb-1.5 flex items-baseline gap-2 text-sm font-semibold",
                  g.key === "waiting" && "text-waiting-ink",
                )}
              >
                {t(`squad.tasks.${g.key}`)}
                <span className="text-xs font-medium text-ink-3 tabular-nums">{items.length}</span>
              </h2>
              <ul className="overflow-hidden rounded-xl border border-hairline">
                {items.map((x, i) => (
                  <TaskRow
                    key={x.task.id}
                    view={view}
                    task={x}
                    first={i === 0}
                    selected={selectedTaskId === x.task.id}
                    onSelect={() => onSelectTask(x.task.id)}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function TaskRow({
  view,
  task: x,
  first,
  selected,
  onSelect,
}: {
  view: SquadView;
  task: TaskView;
  first: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const role = view.role(x.role);
  return (
    <li className={cn(!first && "border-t border-hairline")}>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "grid w-full grid-cols-[16px_minmax(0,1fr)_140px_64px] items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-panel max-[700px]:grid-cols-[16px_minmax(0,1fr)]",
          selected && "bg-panel",
        )}
      >
        <StationGlyph status={x.status} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-ink">{x.task.title}</span>
          <span className="block truncate text-xs text-ink-3">
            {x.task.dependsOn.length > 0
              ? t("squad.board.after", {
                  tasks: x.task.dependsOn.map((d) => titleOf(view.plan, d)).join(", "),
                })
              : x.task.plainSummary}
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-2 max-[700px]:hidden">
          {role && (
            <LineBadge agentType={role.colorKey} code={role.code} title={role.name} size={16} />
          )}
          <span className="truncate">{role?.name ?? x.role}</span>
        </span>
        <span className="text-right text-xs text-ink-3 max-[700px]:hidden">
          {t(`squad.size.${x.task.size}`)}
        </span>
      </button>
    </li>
  );
}
