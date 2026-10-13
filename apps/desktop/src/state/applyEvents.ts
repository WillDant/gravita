import { apply, type GravitaState } from "@gravita/core";
import type { GravitaEvent } from "@gravita/protocol";

/**
 * Applies a batch with structural sharing: the core reducer mutates for speed, so it
 * runs on a working copy where only the sessions and projects the batch touches are
 * cloned. Everything else keeps its reference, so components that select one session
 * or project re-render only when that object changed.
 */
export function applyEvents(prev: GravitaState, events: readonly GravitaEvent[]): GravitaState {
  if (events.length === 0) return prev;
  const next: GravitaState = {
    ...prev,
    projects: { ...prev.projects },
    sessions: { ...prev.sessions },
  };
  const drafted = { projects: new Set<string>(), sessions: new Set<string>() };

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

  // `apply` touches exactly: the event's project, its session, and that session's project.
  for (const e of events) {
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
