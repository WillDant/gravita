import type { Query } from "@anthropic-ai/claude-agent-sdk";
import { claudePlanUsage } from "@gravita/adapter-claude";
import type { Logger } from "../../application/ports/logger";
import type { PlanUsageReading, PlanUsageSource } from "../../application/ports/plan-usage-source";
import type { SessionRuntimeRegistry } from "../../application/ports/session-runtime";
import { PLAN_USAGE_READ_TIMEOUT_MS } from "../../domain/squad-policy";
import { CLAUDE } from "./provider";
import { ClaudeSdkRuntime } from "./sdk/claude-sdk-runtime";

// Claude's plan usage, read on demand. Claude Code has no standalone usage API: a running
// session's query answers it, through the Agent SDK's usage read. That call is experimental
// ("may change, do not rely on it yet"), so its name lives in this file alone; when it is
// missing, throws or answers another shape, the read gives nothing and Gravita relies on the
// rate limit events of the stream and the last values it knows.

/** The Agent SDK's experimental usage read (the name changes once the API is stable). */
const USAGE_READ = "usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET";

type UsageRead = (opts?: { skipBehaviors?: boolean }) => Promise<unknown>;

/** The usage read of `query`, if this SDK has it. */
function usageReadOf(query: Query): UsageRead | undefined {
  const read = (query as unknown as Record<string, unknown>)[USAGE_READ];
  return typeof read === "function" ? (read.bind(query) as UsageRead) : undefined;
}

export class ClaudePlanUsageSource implements PlanUsageSource {
  readonly provider = CLAUDE;

  constructor(
    private readonly d: {
      runtimes: SessionRuntimeRegistry;
      logger: Logger;
      timeoutMs?: number;
    },
  ) {}

  async read(prefer: readonly string[] = []): Promise<PlanUsageReading | undefined> {
    const query = this.liveQuery(prefer);
    const read = query && usageReadOf(query);
    if (!read) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Only the plan windows: skipBehaviors skips a scan of the week's local transcripts.
      const answer = await Promise.race([
        read({ skipBehaviors: true }),
        new Promise<undefined>((resolve) => {
          timer = setTimeout(
            () => resolve(undefined),
            this.d.timeoutMs ?? PLAN_USAGE_READ_TIMEOUT_MS,
          );
        }),
      ]);
      return claudePlanUsage(answer);
    } catch (err) {
      this.d.logger.log("claude's usage read failed", err);
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  /** A running Claude Code session's query: `prefer`'s first, else any (never a new one). */
  private liveQuery(prefer: readonly string[]): Query | undefined {
    const runtimes = [
      ...prefer.flatMap((id) => {
        const rt = this.d.runtimes.get(id);
        return rt ? [rt] : [];
      }),
      ...this.d.runtimes.all(),
    ];
    for (const rt of runtimes) {
      if (!(rt instanceof ClaudeSdkRuntime)) continue;
      const query = rt.liveQuery();
      if (query) return query;
    }
    return undefined;
  }
}
