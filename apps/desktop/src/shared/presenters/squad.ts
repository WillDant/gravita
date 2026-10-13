import {
  type GravitaState,
  type ProjectState,
  type SessionCounts,
  type SessionState,
  type SquadState,
  sessionCounts,
  squadPlan,
  squadProgress,
} from "@gravita/core";
import { lineCode } from "@gravita/orbs";
import type { PlanRole, SquadPhase, SquadPlan } from "@gravita/protocol";
import { needsYou } from "./selectors";

// What the app shell says about squads: their title, where they stand, and what they
// wait on you for. Pure; the squad screen's own presenters live with it.

/** Pool hues for custom roles, in the order they are handed out. */
const CUSTOM_HUES = ["role-rose", "role-sky", "role-orchid", "role-mustard", "role-green"] as const;
/** The pool hue a built-in role kind already draws in. */
const KIND_HUE: Partial<Record<PlanRole["kind"], string>> = {
  // Close enough to read as the same line: sky beside backend's blue, rose beside
  // frontend's coral. A plan with those roles never hands those hues to a custom role.
  backend: "role-sky",
  frontend: "role-rose",
  design: "role-mustard",
  tests: "role-green",
};
/** The pool hue a built-in kind draws in exactly (not just resembles). */
const SAME_HUE: Partial<Record<PlanRole["kind"], string>> = {
  design: "role-mustard",
  tests: "role-green",
};

/**
 * The colour slot a role draws in, everywhere (map, badges, orbs, Board, Orbit): its kind
 * for the built-in roles; for custom roles, in plan order, the first pool hue that no
 * built-in role of the same plan already uses. Stable for a given plan.
 */
export function roleColorKey(
  role: Pick<PlanRole, "id" | "kind">,
  plan?: { roles: readonly Pick<PlanRole, "id" | "kind">[] },
): string {
  if (role.kind !== "custom") return role.kind;
  if (!plan) return role.id;
  const kinds = new Set(plan.roles.map((r) => r.kind));
  const near = new Set([...kinds].map((k) => KIND_HUE[k]).filter(Boolean));
  const same = new Set([...kinds].map((k) => SAME_HUE[k]).filter(Boolean));
  // First the hues no role comes close to; then, before any repeat, the hues that only
  // resemble a built-in role's (sky beside blue); a built-in's own hue comes last.
  const order = [
    ...CUSTOM_HUES.filter((h) => !near.has(h)),
    ...CUSTOM_HUES.filter((h) => near.has(h) && !same.has(h)),
  ];
  const pool = order.length ? order : [...CUSTOM_HUES];
  const index = plan.roles.filter((r) => r.kind === "custom").findIndex((r) => r.id === role.id);
  return pool[index % pool.length] ?? role.id;
}

/** The letters on a role's line-code disc: its kind's, or its name's for custom roles. */
export function roleCode(role: Pick<PlanRole, "kind" | "name">): string {
  return lineCode(role.kind === "custom" ? role.name : role.kind);
}

/** The plan role with this id, or a planner stand-in (the planner isn't a plan role). */
export function roleOf(plan: SquadPlan | undefined, roleId: string): PlanRole | undefined {
  return plan?.roles.find((r) => r.id === roleId);
}

/** The squad's name: the first line of what the user asked for, else the plan's goal. */
export function squadTitle(q: SquadState): string {
  const first = q.brief
    .split("\n")
    .find((l) => l.trim())
    ?.trim();
  const text = first || q.plan?.goal || q.id;
  return text.length > 90 ? `${text.slice(0, 89)}…` : text;
}

/** The squad's sessions that exist in the projection. */
export function squadSessions(state: GravitaState, q: SquadState): SessionState[] {
  return q.sessionIds.map((id) => state.sessions[id]).filter((s): s is SessionState => Boolean(s));
}

const ZERO: SessionCounts = { running: 0, subagents: 0, waiting: 0, subagentsTotal: 0 };

/** Running / subagents / waiting over every session of the squad. */
export function squadCounts(state: GravitaState, q: SquadState, now: number): SessionCounts {
  return squadSessions(state, q).reduce((acc, s) => {
    const c = sessionCounts(s, now);
    return {
      running: acc.running + c.running,
      subagents: acc.subagents + c.subagents,
      waiting: acc.waiting + c.waiting,
      subagentsTotal: acc.subagentsTotal + c.subagentsTotal,
    };
  }, ZERO);
}

/** The squad is still going somewhere (not finished, failed or stopped). */
export function squadActive(q: SquadState): boolean {
  return q.phase !== "done" && q.phase !== "failed" && q.phase !== "stopped";
}

/** Why a squad is paused, as the UI words it. */
export type PauseKind = "budget" | "restart" | "killSwitch" | "user" | "other";

// The engine's own reasons for the pauses it starts (squad-scheduler's PAUSE_REASONS).
const RESTART = /^Gravita restarted/;
const KILL_SWITCH = /kill switch/i;
const BY_USER = /^Paused by you/;

export function pauseKind(q: SquadState): PauseKind | undefined {
  if (!q.paused) return undefined;
  const reason = q.paused.reason;
  // A plan squad pauses for its budget only when its share ran out (its reasons may name
  // dollars, e.g. an API-key account, and that isn't a budget to raise).
  if (q.budgetPlan) {
    if (q.budget.exhausted.includes(`squad:${q.id}`)) return "budget";
  } else if (q.budget.exhausted.some((k) => !k.startsWith("task:")) || /budget/i.test(reason))
    return "budget";
  if (RESTART.test(reason)) return "restart";
  if (KILL_SWITCH.test(reason)) return "killSwitch";
  if (BY_USER.test(reason)) return "user";
  return "other";
}

/** Something a squad waits on the user for (besides its sessions' own asks). */
export type SquadDecision =
  | { kind: "review" }
  | { kind: "deliver" }
  | { kind: "paused"; pause: PauseKind; reason: string }
  | { kind: "task"; taskId: string; status: "blocked" | "failed"; reason?: string }
  | { kind: "plannerFailed"; reason?: string };

/** What the squad waits on you for, most pressing first. */
export function squadDecisions(q: SquadState): SquadDecision[] {
  const out: SquadDecision[] = [];
  const pause = pauseKind(q);
  if (q.paused && pause && pause !== "user" && squadActive(q))
    out.push({ kind: "paused", pause, reason: q.paused.reason });
  if (q.phase === "failed" && q.planStatus !== "approved")
    out.push({ kind: "plannerFailed", ...(q.phaseReason ? { reason: q.phaseReason } : {}) });
  if (squadActive(q)) {
    const plan = squadPlan(q);
    for (const t of plan?.tasks ?? []) {
      const run = q.tasks[t.id];
      if (run && (run.status === "blocked" || run.status === "failed"))
        out.push({
          kind: "task",
          taskId: t.id,
          status: run.status,
          ...(run.reason ? { reason: run.reason } : {}),
        });
    }
  }
  if (q.phase === "review" && q.plan) out.push({ kind: "review" });
  if (q.phase === "deliver" && !q.delivered) out.push({ kind: "deliver" });
  return out;
}

export interface SquadDecisionItem {
  project: ProjectState;
  squad: SquadState;
  decision: SquadDecision;
}

/** Every squad decision across projects, for Home's "Needs you" and the sidebar count. */
export function squadNeedsYou(state: GravitaState): SquadDecisionItem[] {
  const out: SquadDecisionItem[] = [];
  for (const q of Object.values(state.squads ?? {})) {
    const project = state.projects[q.projectId];
    if (!project || !q.created) continue;
    for (const decision of squadDecisions(q)) out.push({ project, squad: q, decision });
  }
  return out.sort((a, b) => b.squad.lastEventTs.localeCompare(a.squad.lastEventTs));
}

/** Sessions and squads waiting on the user: the one "Needs you" count. */
export function needsYouCount(state: GravitaState, now: number): number {
  return needsYou(state, now).length + squadNeedsYou(state).length;
}

/** The six stops of a squad's line, in order. */
export const PHASE_STOPS = ["brief", "plan", "foundation", "build", "verify", "deliver"] as const;
export type PhaseStop = (typeof PHASE_STOPS)[number];

/** Which stop of the phase track a squad phase sits on. */
export function phaseStop(phase: SquadPhase): PhaseStop | undefined {
  switch (phase) {
    case "brief":
      return "brief";
    case "planning":
    case "review":
      return "plan";
    case "foundation":
    case "build":
    case "verify":
    case "deliver":
      return phase;
    case "done":
      return "deliver";
    default:
      return undefined;
  }
}

/** Done / total over the plan the squad runs (approved plan plus added tasks). */
export function squadDone(q: SquadState): { done: number; total: number } {
  const plan = squadPlan(q);
  if (!plan) return { done: 0, total: 0 };
  const p = squadProgress(plan, q.tasks);
  return { done: p.done, total: p.total };
}

/** One row of a project's list: a plain session, or a squad standing for all its sessions. */
export type ProjectItem =
  | { kind: "session"; session: SessionState; lastEventTs: string }
  | { kind: "squad"; squad: SquadState; sessions: SessionState[]; lastEventTs: string };

/**
 * A project's sessions with every squad's sessions folded into one squad row, newest
 * first. Role sessions stay reachable from inside their squad.
 */
export function projectItems(state: GravitaState, project: ProjectState): ProjectItem[] {
  const items: ProjectItem[] = [];
  const squads = new Map<string, SessionState[]>();
  for (const id of project.sessionIds) {
    const s = state.sessions[id];
    if (!s) continue;
    if (s.squadId && state.squads?.[s.squadId]?.created) {
      const list = squads.get(s.squadId) ?? [];
      list.push(s);
      squads.set(s.squadId, list);
    } else {
      items.push({ kind: "session", session: s, lastEventTs: s.lastEventTs });
    }
  }
  for (const q of Object.values(state.squads ?? {})) {
    if (q.projectId !== project.id || !q.created) continue;
    const sessions = squads.get(q.id) ?? [];
    const last = sessions.reduce((m, s) => (s.lastEventTs > m ? s.lastEventTs : m), q.lastEventTs);
    items.push({ kind: "squad", squad: q, sessions, lastEventTs: last });
  }
  return items.sort((a, b) => b.lastEventTs.localeCompare(a.lastEventTs));
}
