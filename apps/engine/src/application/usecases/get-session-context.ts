import type { SessionContextResult } from "@gravita/protocol";
import type { Clock } from "../ports/clock";
import type { Logger } from "../ports/logger";
import type { SessionRuntimeRegistry } from "../ports/session-runtime";

/** Counting every category asks the token-count API; past this, the panel shows the total. */
const ASK_TIMEOUT_MS = 8_000;

/**
 * What fills a session's context window, asked of the runtime that runs it. Sessions Gravita
 * doesn't run (a terminal, another app) and runtimes that can't tell answer `unavailable`.
 */
export class GetSessionContext {
  constructor(
    private readonly runtimes: SessionRuntimeRegistry,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  async execute(p: { sessionId: string }): Promise<SessionContextResult> {
    const runtime = this.runtimes.get(p.sessionId);
    if (!runtime?.contextUsage) return { kind: "unavailable" };
    try {
      const usage = await this.withTimeout(runtime.contextUsage());
      return usage ? { kind: "full", usage } : { kind: "unavailable" };
    } catch (err) {
      this.logger.log("reading the context usage failed", err);
      return { kind: "unavailable" };
    }
  }

  private withTimeout<T>(p: Promise<T>): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      const cancel = this.clock.setTimer(() => resolve(undefined), ASK_TIMEOUT_MS);
      p.then(
        (v) => {
          cancel();
          resolve(v);
        },
        (e: unknown) => {
          cancel();
          reject(e);
        },
      );
    });
  }
}
