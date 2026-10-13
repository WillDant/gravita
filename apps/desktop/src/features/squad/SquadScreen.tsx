import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@/app/providers";
import { t, useLocale } from "@/shared/i18n/i18n";
import { squadTitle } from "@/shared/presenters/squad";
import { useAppStore, useNow, useProjection } from "@/state/hooks";
import { Board } from "./board/Board";
import { Brief } from "./brief/Brief";
import { SquadBanner } from "./header/SquadBanner";
import { SquadHeader } from "./header/SquadHeader";
import { squadView } from "./model";
import { Run, type RunLens } from "./run/Run";

/**
 * A squad from goal to delivered branch, on one screen whose body follows the phase:
 * the brief (a conversation with the planner), the Board (review the plan), the run
 * (the squad's map) and delivery.
 */
export default function SquadScreen({
  projectId,
  squadId,
  taskId,
}: {
  projectId: string;
  squadId: string;
  taskId?: string;
}) {
  useLocale();
  const state = useProjection((p) => p);
  const squad = state.squads?.[squadId];
  const project = state.projects[projectId];
  const now = useNow();
  const navigate = useNavigate();
  const starting = useAppStore((s) => s.startingSquadId);
  const view = useMemo(() => (squad ? squadView(state, squad) : undefined), [state, squad]);
  const [role, setRole] = useState<string>();
  const finishing =
    squad?.phase === "deliver" || squad?.phase === "done" || Boolean(squad?.delivered);
  const [lens, setLens] = useState<RunLens>(finishing ? "deliver" : "lines");
  // Reaching the end of the line brings the delivery choice forward once.
  useEffect(() => {
    if (finishing) setLens("deliver");
  }, [finishing]);

  useEffect(() => {
    document.title = squad ? `${squadTitle(squad)} · Gravita` : "Gravita";
    return () => {
      document.title = "Gravita";
    };
  }, [squad]);

  if (!squad?.created || !project || !view) {
    return (
      <p role="status" className="p-8 text-ink-2">
        {starting === squadId ? t("squad.starting") : t("squad.notFound")}
      </p>
    );
  }

  const selectTask = (id: string) => {
    setRole(undefined);
    navigate({ level: "squad", projectId, squadId, taskId: id });
  };
  const selectRole = (id: string) => {
    setRole(id);
    if (taskId) navigate({ level: "squad", projectId, squadId });
  };
  const close = () => {
    setRole(undefined);
    if (taskId) navigate({ level: "squad", projectId, squadId });
  };

  const approved = squad.planStatus === "approved";
  let body: React.ReactNode;
  if (squad.phase === "review" && squad.plan) {
    body = <Board squad={squad} plan={squad.plan} />;
  } else if (!approved) {
    body = <Brief squad={squad} view={view} now={now} />;
  } else {
    body = (
      <Run
        squad={squad}
        view={view}
        project={project}
        now={now}
        lens={lens === "deliver" && !finishing ? "lines" : lens}
        onLens={setLens}
        {...(taskId ? { selectedTaskId: taskId } : {})}
        {...(role ? { selectedRoleId: role } : {})}
        onSelectTask={selectTask}
        onSelectRole={selectRole}
        onClosePanel={close}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SquadHeader squad={squad} view={view} projectName={project.name} />
      <SquadBanner squad={squad} />
      {body}
    </div>
  );
}
