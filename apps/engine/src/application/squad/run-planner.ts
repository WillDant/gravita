import { pickModel, type SquadState, validatePlan } from "@gravita/core";
import { SquadPlan, squadPlanJsonSchema } from "@gravita/protocol";
import {
  MAX_PLAN_ATTEMPTS,
  PLANNER_MAX_TURNS,
  PLANNER_ROLE_ID,
  SQUAD_PROVIDER,
  STOP_GRACE_MS,
  squadSubagents,
} from "../../domain/squad-policy";
import type { TurnOutcome } from "../ports/chat-runtime";
import type { SquadReader } from "../ports/squad-reader";
import type { BudgetGuard } from "./budget-guard";
import {
  type BriefingLine,
  PLANNER_CHARTER,
  planFixPrompt,
  plannerPrompt,
  resumedPlannerPrompt,
} from "./prompts";
import type { SquadEmitter } from "./squad-emitter";
import type { SquadRun } from "./squad-run";
import type { SquadSessions } from "./squad-sessions";

// The planner: a read-only agent session in the user's repository that answers with a
// SquadPlan as structured output. It resumes the briefing conversation when it can (so it
// keeps what the user told it), else it starts afresh with the brief and a summary of that
// conversation. Gravita checks the shape (zod) and the meaning (validatePlan); a plan with
// problems goes back to the same session with the problems, up to three proposals, before
// the squad fails.

export type PlannerEnd =
  | { kind: "proposed" }
  | { kind: "failed"; reason: string }
  /** Gravita stopped it (pause, stop): it runs again on resume. */
  | { kind: "interrupted" }
  /** Someone else disposed it: the kill switch. */
  | { kind: "killed" }
  /** The session it resumed ended before a single turn (no transcript to go on). */
  | { kind: "unresumable" };

export interface PlannerRun {
  feedback?: string;
  /** Continue this session (the briefing, or the previous planning run). */
  resumeSessionId?: string;
  /** For a fresh session: the briefing conversation it couldn't resume. */
  briefing?: readonly BriefingLine[];
}

/** What's wrong with a structured output as a plan; empty when it is a valid plan. */
export function judgePlan(output: unknown): { plan?: SquadPlan; errors: string[] } {
  if (output === undefined || output === null)
    return { errors: ["You didn't answer with a plan as structured output."] };
  const parsed = SquadPlan.safeParse(output);
  if (!parsed.success)
    return {
      errors: parsed.error.issues
        .slice(0, 20)
        .map((i) => `${i.path.join(".") || "plan"}: ${i.message}`),
    };
  const issues = validatePlan(parsed.data);
  return issues.length
    ? { errors: issues.map((i) => i.message) }
    : { plan: parsed.data, errors: [] };
}

const FAILURES: Record<string, string> = {
  error_max_budget_usd: "The planner used up its share of the budget before finishing the plan.",
  error_max_turns: "The planner ran out of turns before finishing the plan.",
};

export class RunPlanner {
  constructor(
    private readonly d: {
      sessions: SquadSessions;
      squads: SquadReader;
      emitter: SquadEmitter;
      budget: BudgetGuard;
    },
  ) {}

  /** Runs the planner in `cwd` (the repository, or the empty folder) until it ends. */
  async execute(run: SquadRun, cwd: string, p: PlannerRun = {}): Promise<PlannerEnd> {
    const ref = { squadId: run.squadId, projectId: run.projectId };
    const q = this.current(run);
    const resume = p.resumeSessionId;
    run.plannerStopRequested = false;
    if (q.phase !== "planning") this.d.emitter.phase(ref, "planning");
    const session = await this.d.sessions.start({
      squadId: run.squadId,
      projectId: run.projectId,
      roleId: PLANNER_ROLE_ID,
      cwd,
      // Resuming the briefing may switch models (Sonnet talked, Opus plans): the model is
      // passed on resume too, and Claude Code continues the transcript on it.
      provider: SQUAD_PROVIDER,
      model: pickModel({ models: q.models, phase: "planning" }),
      subagents: squadSubagents(q.models),
      permissionMode: "dontAsk",
      access: "read-only",
      prompt: resume
        ? resumedPlannerPrompt(q, p.feedback)
        : plannerPrompt(q, p.feedback, p.briefing),
      ...(resume ? { resumeSessionId: resume } : {}),
      systemPromptAppend: PLANNER_CHARTER,
      outputSchema: squadPlanJsonSchema(),
      maxTurns: PLANNER_MAX_TURNS,
      maxBudgetUsd: this.d.budget.forPlanner(q, resume),
    });
    run.planner = session;
    run.plannerSessionId = session.sessionId;
    if (run.plannerStopRequested) session.stop(STOP_GRACE_MS);
    try {
      const end = await this.converse(run, session, resume !== undefined);
      if (end.kind === "failed") this.d.emitter.phase(ref, "failed", end.reason);
      return end;
    } finally {
      run.planner = undefined;
      await session.dispose();
    }
  }

  private current(run: SquadRun): SquadState {
    const q = this.d.squads.squad(run.squadId);
    if (!q) throw new Error(`No squad ${run.squadId}`);
    return q;
  }

  private async converse(
    run: SquadRun,
    session: NonNullable<SquadRun["planner"]>,
    resumed: boolean,
  ): Promise<PlannerEnd> {
    const ref = { squadId: run.squadId, projectId: run.projectId };
    for (let tries = 1; ; tries++) {
      const o: TurnOutcome = await session.nextTurn();
      if (session.stopping) return { kind: "interrupted" };
      if (o.kind === "ended") {
        if (o.reason === "disposed" && !session.disposedByGravita) return { kind: "killed" };
        // Claude Code couldn't pick the conversation up: the caller starts afresh.
        if (resumed && tries === 1) return { kind: "unresumable" };
        return { kind: "failed", reason: "The planner's session stopped unexpectedly." };
      }
      const failure = FAILURES[o.subtype];
      if (failure) return { kind: "failed", reason: failure };
      if (o.subtype !== "success" && o.subtype !== "error_max_structured_output_retries")
        return {
          kind: "failed",
          reason: `The planner stopped with an error: ${o.errors.join("; ") || o.subtype}`,
        };

      const attempt = this.current(run).planAttempts + 1;
      const { plan, errors } = judgePlan(o.structuredOutput);
      if (plan) {
        this.d.emitter.planProposed(ref, attempt, plan);
        this.d.emitter.phase(ref, "review");
        return { kind: "proposed" };
      }
      this.d.emitter.planRejected(ref, attempt, errors);
      if (tries >= MAX_PLAN_ATTEMPTS)
        return {
          kind: "failed",
          reason: `The planner couldn't produce a valid plan in ${MAX_PLAN_ATTEMPTS} tries. Last problem: ${errors[0] ?? "unknown"}`,
        };
      await session.send(planFixPrompt(errors));
    }
  }
}
