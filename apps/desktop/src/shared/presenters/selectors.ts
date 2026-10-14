import {
  type AgentNode,
  effectiveLifecycle,
  type GravitaState,
  isRecentlyLive,
  type ProjectState,
  type SessionCounts,
  type SessionState,
  sessionCounts,
} from "@gravita/core";
import { AGENT_PROVIDERS, type AgentProvider } from "@gravita/protocol/constants";
import { MAIN_AGENT } from "@gravita/protocol/ids";

export type SessionStatus = "waiting" | "running" | "idle" | "done" | "error" | "detached";

export function sessionStatus(s: SessionState, now: number): SessionStatus {
  const c = sessionCounts(s, now);
  if (c.waiting > 0) return "waiting";
  if (c.running > 0) return "running";
  const main = s.agents[MAIN_AGENT];
  const lc = main ? effectiveLifecycle(main, s, now) : "idle";
  if (lc === "failed") return "error";
  if (lc === "detached") return "detached";
  if (lc === "idle" && isRecentlyLive(s, now)) return "idle";
  return "done";
}

export function sessionTitle(s: SessionState): string | undefined {
  return s.title ?? s.firstUserText;
}

/**
 * The agent that runs a session. Events also carry "gravita" and "fake" providers, and
 * everything before Codex was Claude Code, so anything but a known agent reads as Claude Code.
 */
export function sessionProvider(s: Pick<SessionState, "provider">): AgentProvider {
  return AGENT_PROVIDERS.find((p) => p === s.provider) ?? "claude";
}

/** Agents that are working or waiting right now, main first, then by spawn time. */
export function liveAgents(s: SessionState, now: number): AgentNode[] {
  return Object.values(s.agents)
    .filter((a) => {
      const lc = effectiveLifecycle(a, s, now);
      return lc === "active" || lc === "waiting_user" || lc === "paused" || lc === "blocked";
    })
    .sort((a, b) =>
      a.id === MAIN_AGENT ? -1 : b.id === MAIN_AGENT ? 1 : a.createdTs.localeCompare(b.createdTs),
    );
}

export interface ProjectSummary {
  project: ProjectState;
  sessions: SessionState[];
  counts: SessionCounts;
  live: { session: SessionState; agent: AgentNode }[];
  lastEventTs: string;
}

const addCounts = (a: SessionCounts, b: SessionCounts): SessionCounts => ({
  running: a.running + b.running,
  subagents: a.subagents + b.subagents,
  waiting: a.waiting + b.waiting,
  subagentsTotal: a.subagentsTotal + b.subagentsTotal,
});

const ZERO: SessionCounts = { running: 0, subagents: 0, waiting: 0, subagentsTotal: 0 };

export function projectSummaries(state: GravitaState, now: number): ProjectSummary[] {
  const out: ProjectSummary[] = [];
  for (const project of Object.values(state.projects)) {
    const sessions = project.sessionIds
      .map((id) => state.sessions[id])
      .filter((s): s is SessionState => Boolean(s))
      .sort((a, b) => b.lastEventTs.localeCompare(a.lastEventTs));
    if (sessions.length === 0) continue;
    let counts = ZERO;
    const live: ProjectSummary["live"] = [];
    for (const s of sessions) {
      counts = addCounts(counts, sessionCounts(s, now));
      for (const agent of liveAgents(s, now)) live.push({ session: s, agent });
    }
    out.push({ project, sessions, counts, live, lastEventTs: sessions[0]!.lastEventTs });
  }
  return out.sort(
    (a, b) =>
      b.counts.waiting - a.counts.waiting ||
      b.counts.running - a.counts.running ||
      b.lastEventTs.localeCompare(a.lastEventTs),
  );
}

export function totals(summaries: ProjectSummary[]): SessionCounts {
  return summaries.reduce((acc, p) => addCounts(acc, p.counts), ZERO);
}

export interface WaitingItem {
  project: ProjectState;
  session: SessionState;
  agent: AgentNode;
}

export function needsYou(state: GravitaState, now: number): WaitingItem[] {
  const items: WaitingItem[] = [];
  for (const s of Object.values(state.sessions)) {
    const project = state.projects[s.projectId];
    if (!project) continue;
    for (const a of Object.values(s.agents)) {
      if (effectiveLifecycle(a, s, now) === "waiting_user")
        items.push({ project, session: s, agent: a });
    }
  }
  return items.sort((x, y) => y.agent.lastEventTs.localeCompare(x.agent.lastEventTs));
}

export function tokensOf(s: SessionState): number {
  let n = 0;
  for (const a of Object.values(s.agents))
    n += a.tokens.input + a.tokens.output + a.tokens.cacheWrite;
  return n;
}

/** What the menu-bar tray shows: agents working, agents waiting on you, kill-switch reach. */
export interface TrayCounts {
  running: number;
  waiting: number;
  /** Sessions Gravita runs that are working or waiting now (what "Stop all" would stop). */
  controllable: number;
}

export function trayCounts(state: GravitaState, now: number): TrayCounts {
  const all = totals(projectSummaries(state, now));
  let controllable = 0;
  for (const s of Object.values(state.sessions)) {
    if (!s.controllable) continue;
    const status = sessionStatus(s, now);
    if (status === "running" || status === "waiting") controllable++;
  }
  return { running: all.running, waiting: needsYou(state, now).length, controllable };
}
