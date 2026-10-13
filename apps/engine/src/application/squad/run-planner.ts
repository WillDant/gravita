import { type SquadState, validatePlan } from "@gravita/core";
import { SquadPlan, squadPlanJsonSchema } from "@gravita/protocol";
import {
  PLANNER_DISALLOWED_TOOLS,
  PLANNER_TOOLS,
  plannerPermission,
} from "../../domain/autonomy-policy";
import { MAX_PLAN_ATTEMPTS, PLANNER_MAX_TURNS, STOP_GRACE_MS } from "../../domain/squad-policy";
import type { TurnOutcome } from "../ports/chat-runtime";
import type { SquadReader } from "../ports/squad-reader";
import type { BudgetGuard } from "./budget-guard";
import { PLANNER_CHARTER, planFixPrompt, plannerPrompt } from "./prompts";
import type { SquadEmitter } from "./squad-emitter";
import type { SquadRun } from "./squad-run";
import type { SquadSessions } from "./squad-sessions";

// The planner: a read-only Claude Code session in the user's repository that answers with a
// SquadPlan as structured output. Gravita checks the shape (zod) and the meaning
// (validatePlan); a plan with problems goes back to the same session with the problems,
// up to three proposals, before the squad fails.

export type PlannerEnd =
  | { kind: "proposed" }
  | { kind: "failed"; reason: string }
  /** Gravita stopped it (pause, stop): it runs again on resume. */
  | { kind: "interrupted" }
  /** Someone else disposed it: the kill switch. */
  | { kind: "killed" };

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
  async execute(run: SquadRun, cwd: string, feedback?: string): Promise<PlannerEnd> {
    const ref = { squadId: run.squadId, projectId: run.projectId };
    const q = this.current(run);
    run.plannerStopRequested = false;
    if (q.phase !== "planning") this.d.emitter.phase(ref, "planning");
    const session = await this.d.sessions.start({
      squadId: run.squadId,
      projectId: run.projectId,
      cwd,
      model: q.models.planner,
      permissionMode: "dontAsk",
      prompt: plannerPrompt(q, feedback),
      systemPromptAppend: PLANNER_CHARTER,
      tools: [...PLANNER_TOOLS],
      disallowedTools: [...PLANNER_DISALLOWED_TOOLS],
      outputSchema: squadPlanJsonSchema(),
      maxTurns: PLANNER_MAX_TURNS,
      maxBudgetUsd: this.d.budget.forPlanner(q),
      permissionPolicy: (tool) => plannerPermission(tool),
    });
    run.planner = session;
    if (run.plannerStopRequested) session.stop(STOP_GRACE_MS);
    try {
      const end = await this.converse(run, session);
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
  ): Promise<PlannerEnd> {
    const ref = { squadId: run.squadId, projectId: run.projectId };
    for (let tries = 1; ; tries++) {
      const o: TurnOutcome = await session.nextTurn();
      if (session.stopping) return { kind: "interrupted" };
      if (o.kind === "ended")
        return o.reason === "disposed" && !session.disposedByGravita
          ? { kind: "killed" }
          : { kind: "failed", reason: "The planner's session stopped unexpectedly." };
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
