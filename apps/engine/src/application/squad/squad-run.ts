import type { SquadState } from "@gravita/core";
import { type SquadLayout, squadLayout } from "../../domain/squad-workspace";
import type { MergeResult } from "../services/merge-queue";
import type { RoleBinding } from "./role-tools";
import type { SquadSession } from "./squad-sessions";

// What the orchestrator keeps in memory about a squad while the engine runs. Everything
// that must survive a restart lives in the projection (events); this is only the live
// part: sessions, the attempt each role is on, and counters that reset with the engine.

/** One run of a task by its role, while it is in flight. */
export interface LiveAttempt extends RoleBinding {
  projectId: string;
  /** The role's worktree and branch, and the integration branch it builds on. */
  worktree: string;
  roleBranch: string;
  integrationBranch: string;
  session?: SquadSession;
  /** The session's maxBudgetUsd. */
  maxBudgetUsd: number;
  /** complete_task calls sent back (ownership violations, red task checks). */
  bounces: number;
  progressCount: number;
  /** complete_task succeeded: the commit, and the merge it queued (none when nothing changed). */
  completion?: { sha: string | null; summary: string; merge?: Promise<MergeResult> };
  /** yield_blocked was called. */
  yielded?: string;
  /** Too many bounces: the task fails when the turn ends. */
  failed?: string;
  /** Gravita wants it stopped (pause, stop, budget), maybe before its session even started. */
  stopRequested?: boolean;
}

export class SquadRun {
  /** Tasks in flight, by task id (reserved before their session starts). */
  readonly active = new Map<string, LiveAttempt>();
  planner?: SquadSession;
  /** The planner should stop (a pause came while its session was starting). */
  plannerStopRequested = false;
  /** Automatic re-runs per task since the user last decided; capped by MAX_AUTO_ATTEMPTS. */
  readonly retries = new Map<string, number>();
  /** Tasks to continue in their interrupted session (pause, kill switch, restart). */
  readonly resumeFrom = new Map<string, string>();
  /** A model the user picked when retrying a task. */
  readonly modelOverride = new Map<string, string>();
  /** The last replan feedback, for a planner restarted by a resume. */
  replanFeedback?: string;
  /** Rounds of bug fixing after red final checks. */
  verifyRounds = 0;
  /** Something long is running on the squad (verify, freezing contracts, the planner). */
  busy = false;
  /** Work started for this squad and not finished yet (task runs, the planner, verify). */
  private readonly inflight = new Set<Promise<unknown>>();

  constructor(
    readonly squadId: string,
    readonly projectId: string,
    readonly layout: SquadLayout,
  ) {}

  /** Keeps track of background work (which handles its own errors), so tests can wait for it. */
  track(p: Promise<unknown>) {
    const tracked: Promise<unknown> = p
      .catch(() => {})
      .finally(() => this.inflight.delete(tracked));
    this.inflight.add(tracked);
  }

  /** Resolves once no work is in flight (work started meanwhile is waited for too). */
  async idle(): Promise<void> {
    while (this.inflight.size) await Promise.allSettled([...this.inflight]);
  }

  /** Every session the squad has open. */
  sessions(): SquadSession[] {
    const all = [...this.active.values()].flatMap((a) => (a.session ? [a.session] : []));
    return this.planner ? [this.planner, ...all] : all;
  }
}

/** The squads' live state, created on first use from the projection's facts. */
export class SquadRuns {
  private readonly runs = new Map<string, SquadRun>();

  constructor(private readonly worktreesRoot: string) {}

  get(squadId: string): SquadRun | undefined {
    return this.runs.get(squadId);
  }

  of(q: Pick<SquadState, "id" | "projectId">): SquadRun {
    let run = this.runs.get(q.id);
    if (!run) {
      run = new SquadRun(q.id, q.projectId, squadLayout(this.worktreesRoot, q.projectId, q.id));
      this.runs.set(q.id, run);
    }
    return run;
  }

  /** The live attempt a role tool binding belongs to, if it is still the one running. */
  attempt(b: RoleBinding): LiveAttempt | undefined {
    const live = this.runs.get(b.squadId)?.active.get(b.taskId);
    return live && live.attempt === b.attempt && live.roleId === b.roleId ? live : undefined;
  }
}
