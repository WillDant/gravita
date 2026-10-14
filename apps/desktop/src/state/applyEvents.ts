import { apply, type GravitaState } from "@gravita/core";
import type { GravitaEvent } from "@gravita/protocol";

/** The squad an event can change: its own (squad events, a role session starting) or its session's. */
function squadOf(state: GravitaState, e: GravitaEvent): string | undefined {
  const data = e.data as { squadId?: unknown };
  if (typeof data.squadId === "string") return data.squadId;
  return e.sessionId ? state.sessions[e.sessionId]?.squadId : undefined;
}

/**
 * Applies a batch with structural sharing: the core reducer mutates for speed, so it
 * runs on a working copy where only the sessions, projects and squads the batch touches
 * are cloned. Everything else keeps its reference, so components that select one
 * session, project or squad re-render only when that object changed.
 */
export function applyEvents(prev: GravitaState, events: readonly GravitaEvent[]): GravitaState {
  if (events.length === 0) return prev;
  const next: GravitaState = {
    ...prev,
    projects: { ...prev.projects },
    sessions: { ...prev.sessions },
    squads: { ...prev.squads },
    usage: { ...prev.usage },
  };
  const drafted = {
    projects: new Set<string>(),
    sessions: new Set<string>(),
    squads: new Set<string>(),
  };

  const draftProject = (id: string) => {
    if (drafted.projects.has(id)) return;
    drafted.projects.add(id);
    const p = next.projects[id];
    if (p) next.projects[id] = { ...p, sessionIds: [...p.sessionIds] };
  };
  const draftSession = (id: string) => {
    if (drafted.sessions.has(id)) return;
    drafted.sessions.add(id);
    const s = next.sessions[id];
    if (s) next.sessions[id] = structuredClone(s);
  };

  const draftSquad = (id: string) => {
    if (drafted.squads.has(id)) return;
    drafted.squads.add(id);
    const q = next.squads[id];
    if (q) next.squads[id] = structuredClone(q);
  };

  // `apply` touches exactly: the event's project, its session, that session's project,
  // and the squad the event or its session belongs to (spend follows session costs).
  for (const e of events) {
    // A plan usage reading moves the meters of every plan squad.
    if (e.type === "usage.limits")
      for (const q of Object.values(next.squads)) if (q.budget.meters) draftSquad(q.id);
    const squadId = squadOf(next, e);
    if (squadId) draftSquad(squadId);
    draftProject(e.projectId);
    if (e.sessionId) {
      draftSession(e.sessionId);
      const s = next.sessions[e.sessionId];
      if (s) draftProject(s.projectId);
    }
    apply(next, e);
  }
  return next;
}
