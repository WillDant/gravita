import { keys, type PlanCheck, type SquadPlan } from "@gravita/protocol";
import { CheckRefusedError } from "../../domain/errors";
import type { CheckRunner } from "../ports/check-runner";
import type { Clock } from "../ports/clock";
import { squadEvent } from "../services/squad-events";
import type { IngestEvents } from "./ingest-events";

/** What `check.ran` carries of the output: its tail, at most this many bytes. */
export const CHECK_PREVIEW_BYTES = 2 * 1024;

export interface RunChecksParams {
  squadId: string;
  projectId: string;
  plan: SquadPlan;
  /** The worktree the checks run in. */
  worktree: string;
  when: PlanCheck["when"];
  /** Tells this run apart from others of the same checks (part of the event key). */
  runId: string;
  /** Stop at the first red check (the merge queue does: one red is enough to revert). */
  failFast?: boolean;
}

export interface CheckResult {
  checkId: string;
  ok: boolean;
  exitCode: number | null;
  durationMs: number;
  /** The output's tail (larger than the event's preview). */
  output: string;
  timedOut: boolean;
}

const utf8 = new TextEncoder();

/** The end of `text`, at most `maxBytes` of UTF-8. */
export function tailBytes(text: string, maxBytes: number): string {
  const bytes = (s: string) => utf8.encode(s).length;
  let out = text.slice(-maxBytes);
  while (bytes(out) > maxBytes) out = out.slice(Math.ceil(out.length / 10));
  return out;
}

/** Runs the plan's checks for one moment (task, integration, final), each as `check.ran`. */
export class RunChecks {
  constructor(
    private readonly d: {
      runner: CheckRunner;
      ingest: IngestEvents;
      clock: Clock;
      timeoutMs?: number;
    },
  ) {}

  async execute(p: RunChecksParams): Promise<CheckResult[]> {
    const results: CheckResult[] = [];
    for (const check of p.plan.checks.filter((c) => c.when === p.when)) {
      const result = await this.runOne(check, p.worktree);
      results.push(result);
      this.d.ingest.execute([
        squadEvent(
          "check.ran",
          {
            key: keys.checkRan(p.squadId, check.id, p.runId),
            ts: this.d.clock.iso(),
            projectId: p.projectId,
          },
          {
            squadId: p.squadId,
            checkId: check.id,
            runId: p.runId,
            ok: result.ok,
            durationMs: result.durationMs,
            outputPreview: tailBytes(result.output, CHECK_PREVIEW_BYTES),
          },
        ),
      ]);
      if (!result.ok && p.failFast) break;
    }
    return results;
  }

  private async runOne(check: PlanCheck, worktree: string): Promise<CheckResult> {
    try {
      const o = await this.d.runner.run({
        argv: check.argv,
        root: worktree,
        cwd: check.cwd,
        ...(this.d.timeoutMs ? { timeoutMs: this.d.timeoutMs } : {}),
      });
      return {
        checkId: check.id,
        ok: o.ok,
        exitCode: o.exitCode,
        durationMs: o.durationMs,
        output: o.output,
        timedOut: o.timedOut,
      };
    } catch (err) {
      // A refused check is a red check: the plan asked for something that must not run.
      if (!(err instanceof CheckRefusedError)) throw err;
      return {
        checkId: check.id,
        ok: false,
        exitCode: null,
        durationMs: 0,
        output: `Refused: ${err.message}`,
        timedOut: false,
      };
    }
  }
}
