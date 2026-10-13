import {
  type AgentNode,
  effectiveLifecycle,
  type GravitaState,
  type ProjectState,
  type SessionState,
  toPersona,
} from "@gravita/core";
import type { GravitaEvent } from "@gravita/protocol";
import { MAIN_AGENT } from "@gravita/protocol/ids";
import type { NotificationPrefs } from "@/infrastructure/preferences/notificationPrefs";
import { t } from "@/shared/i18n/i18n";
import { agentName, pendingAsk } from "@/shared/presenters/agent";
import { sessionTitle } from "@/shared/presenters/selectors";
import type { Route } from "@/state/slices/route";

// Which live engine events deserve an OS notification, and what it says. Pure: the
// service (notificationService.ts) adds focus gating, coalescing and permission.

export type NotificationKind = "waiting" | "failed" | "finished";

export interface NotificationIntent {
  kind: NotificationKind;
  sessionId: string;
  agentId: string;
  title: string;
  body: string;
  /** Where the notification leads when the user comes back. */
  route: Extract<Route, { level: "session" }>;
}

/**
 * Events older than this aren't news: the engine also streams history while it indexes
 * transcripts, and that must never ring the bell.
 */
export const FRESH_MS = 60_000;

/** Waiting on you beats a failure, which beats a finished turn. */
export const PRIORITY: Record<NotificationKind, number> = { waiting: 0, failed: 1, finished: 2 };

const PREF: Record<NotificationKind, keyof NotificationPrefs> = {
  waiting: "waiting",
  failed: "failures",
  finished: "finished",
};

const MAX_DETAIL = 120;
const clip = (s: string) => (s.length > MAX_DETAIL ? `${s.slice(0, MAX_DETAIL - 1)}…` : s);

function where(project: ProjectState, session: SessionState): string {
  return `${project.name} › ${sessionTitle(session) ?? t("session.untitled")}`;
}

function intent(
  kind: NotificationKind,
  project: ProjectState,
  session: SessionState,
  agent: AgentNode,
  title: string,
  detail?: string,
): NotificationIntent {
  return {
    kind,
    sessionId: session.id,
    agentId: agent.id,
    title,
    body: detail ? `${where(project, session)} · ${clip(detail)}` : where(project, session),
    route: { level: "session", projectId: project.id, sessionId: session.id, agentId: agent.id },
  };
}

/** The agent waits on the user right now (the request wasn't answered in the same batch). */
function isWaiting(session: SessionState, agent: AgentNode, now: number): boolean {
  return effectiveLifecycle(agent, session, now) === "waiting_user";
}

function fresh(e: GravitaEvent, now: number): boolean {
  const ts = Date.parse(e.ts);
  return Number.isFinite(ts) && now - ts <= FRESH_MS;
}

/**
 * The notifications one batch of LIVE events calls for, read against the projection
 * after the batch. Never call it with a snapshot: hydration isn't news. One intent per
 * agent and kind, in batch order.
 */
export function notificationsFor(
  events: readonly GravitaEvent[],
  state: GravitaState,
  now: number,
  prefs: NotificationPrefs,
): NotificationIntent[] {
  const out = new Map<string, NotificationIntent>();
  for (const e of events) {
    if (!e.sessionId || !fresh(e, now)) continue;
    const session = state.sessions[e.sessionId];
    const project = session && state.projects[session.projectId];
    if (!session || !project) continue;
    const agent = session.agents[e.agentId ?? MAIN_AGENT];
    if (!agent) continue;

    let next: NotificationIntent | undefined;
    switch (e.type) {
      case "permission.requested":
      case "question.asked": {
        if (!isWaiting(session, agent, now)) break;
        const persona = toPersona(agent, session, now);
        next = intent(
          "waiting",
          project,
          session,
          agent,
          `${agentName(agent)} ${t(persona.label.key, persona.label.params)}`,
          pendingAsk(agent),
        );
        break;
      }
      case "agent.completed":
        if (e.data.status !== "failed") break;
        next = intent(
          "failed",
          project,
          session,
          agent,
          `${agentName(agent)} ${t("persona.failed")}`,
          e.data.summary,
        );
        break;
      case "error":
        // Retryable errors are the agent's own business (it tries again).
        if (e.data.retryable) break;
        next = intent(
          "failed",
          project,
          session,
          agent,
          `${agentName(agent)} ${t("persona.failed")}`,
          e.data.message,
        );
        break;
      case "turn.completed": {
        // Only chats Gravita runs; a session stopped in the same batch isn't "finished".
        if (!session.controllable || session.ended) break;
        const main = session.agents[MAIN_AGENT] ?? agent;
        if (e.data.subtype?.startsWith("error")) {
          next = intent(
            "failed",
            project,
            session,
            main,
            `${agentName(main)} ${t("persona.failed")}`,
          );
        } else {
          next = intent(
            "finished",
            project,
            session,
            main,
            `${agentName(main)} ${t("persona.done")}`,
          );
        }
        break;
      }
    }
    if (!next || !prefs[PREF[next.kind]]) continue;
    const key = `${next.sessionId}:${next.agentId}:${next.kind}`;
    out.delete(key);
    out.set(key, next);
  }
  return [...out.values()];
}

/**
 * Whether a notification still points at something worth opening: a waiting agent must
 * still be waiting; a finished or failed session must still exist.
 */
export function stillRelevant(n: NotificationIntent, state: GravitaState, now: number): boolean {
  const session = state.sessions[n.sessionId];
  if (!session) return false;
  if (n.kind !== "waiting") return true;
  const agent = session.agents[n.agentId];
  return Boolean(agent && isWaiting(session, agent, now));
}
