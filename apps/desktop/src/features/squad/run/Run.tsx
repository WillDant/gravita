import { type SquadState, squadProgress } from "@gravita/core";
import { lazy, Suspense, useMemo } from "react";
import { t } from "@/shared/i18n/i18n";
import { cn } from "@/shared/utils";
import { Deliver } from "../deliver/Deliver";
import type { SquadView } from "../model";
import { RolePanel } from "./RolePanel";
import { SquadColumn } from "./SquadColumn";
import { SquadMap } from "./squad-map/SquadMap";
import { orbitId, squadOrbitInput } from "./squadOrbit";
import { TaskPanel } from "./TaskPanel";
import { TasksLens } from "./TasksLens";

const OrbitPane = lazy(() =>
  import("@/features/session/orbit-lens/OrbitLens").then((m) => ({ default: m.OrbitPane })),
);

export type RunLens = "deliver" | "lines" | "orbit" | "tasks";

/**
 * A running (or finished) squad: the map in the middle with Orbit and Tasks as other
 * lenses, and the column on the right for what waits on the user, what each role does,
 * and what they say to each other; a task or role opens its panel there instead.
 */
export function Run({
  squad: q,
  view,
  project,
  now,
  lens,
  onLens,
  selectedTaskId,
  selectedRoleId,
  onSelectTask,
  onSelectRole,
  onClosePanel,
}: {
  squad: SquadState;
  view: SquadView;
  project: { id: string; name: string };
  now: number;
  lens: RunLens;
  onLens: (lens: RunLens) => void;
  selectedTaskId?: string;
  selectedRoleId?: string;
  onSelectTask: (taskId: string) => void;
  onSelectRole: (roleId: string) => void;
  onClosePanel: () => void;
}) {
  const finishing = q.phase === "deliver" || q.phase === "done" || Boolean(q.delivered);
  const lenses: RunLens[] = finishing
    ? ["deliver", "lines", "orbit", "tasks"]
    : ["lines", "orbit", "tasks"];
  const progress = view.plan ? squadProgress(view.plan, q.tasks) : undefined;
  const orbit = useMemo(
    () => (lens === "orbit" ? squadOrbitInput(view, project, now) : undefined),
    [lens, view, project, now],
  );

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-none flex-wrap items-center gap-x-4 gap-y-1 px-6 pt-3">
          <div
            role="tablist"
            aria-label={t("squad.lens.label")}
            className="flex rounded-lg bg-panel p-0.5"
          >
            {lenses.map((l) => (
              <button
                key={l}
                type="button"
                role="tab"
                aria-selected={lens === l}
                onClick={() => onLens(l)}
                className={cn(
                  "h-7 rounded-md px-3 text-sm font-medium text-ink-2 transition-colors",
                  lens === l ? "bg-ground text-ink shadow-panel" : "hover:text-ink",
                )}
              >
                {t(`squad.lens.${l}`)}
              </button>
            ))}
          </div>
          {progress && (
            <p className="ml-auto text-xs text-ink-2 tabular-nums">
              {t("squad.progress", { done: progress.done, total: progress.total })}
              {progress.running > 0 &&
                ` · ${t("squad.progressRunning", { count: progress.running })}`}
              {progress.blocked + progress.failed > 0 && (
                <span className="font-semibold text-waiting-ink">
                  {" "}
                  · {t("squad.progressStuck", { count: progress.blocked + progress.failed })}
                </span>
              )}
            </p>
          )}
        </div>
        <div className="min-h-0 flex-1">
          {lens === "deliver" && (
            <Deliver
              squad={q}
              view={view}
              now={now}
              onSelectTask={onSelectTask}
              onSelectRole={onSelectRole}
            />
          )}
          {lens === "lines" && (
            <SquadMap
              squad={q}
              view={view}
              now={now}
              {...(selectedRoleId ? { selectedRoleId } : {})}
              {...(selectedTaskId ? { selectedTaskId } : {})}
              onSelectTask={onSelectTask}
              onSelectRole={onSelectRole}
            />
          )}
          {lens === "orbit" && orbit && (
            <Suspense fallback={null}>
              <OrbitPane
                orbit={orbit}
                projectName={project.name}
                {...(selectedRoleId ? { selectedAgentId: orbitId(selectedRoleId, "main") } : {})}
                onSelect={(id) => onSelectRole(id.split("/")[0] ?? id)}
              />
            </Suspense>
          )}
          {lens === "tasks" && (
            <TasksLens
              view={view}
              {...(selectedTaskId ? { selectedTaskId } : {})}
              onSelectTask={onSelectTask}
            />
          )}
        </div>
      </div>

      <aside className="relative flex w-[340px] flex-none flex-col border-l border-hairline max-[1100px]:w-[300px]">
        {selectedTaskId ? (
          <TaskPanel
            squad={q}
            view={view}
            taskId={selectedTaskId}
            now={now}
            onClose={onClosePanel}
            onSelectTask={onSelectTask}
            onSelectRole={onSelectRole}
          />
        ) : selectedRoleId ? (
          <RolePanel
            squad={q}
            view={view}
            roleId={selectedRoleId}
            now={now}
            onClose={onClosePanel}
            onSelectTask={onSelectTask}
          />
        ) : (
          <SquadColumn
            squad={q}
            view={view}
            now={now}
            onSelectTask={onSelectTask}
            onSelectRole={onSelectRole}
          />
        )}
      </aside>
    </div>
  );
}
