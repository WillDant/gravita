import type { RpcResult } from "@gravita/protocol";
import type { Clock } from "../ports/clock";
import type { Logger } from "../ports/logger";
import type { SessionRuntimeRegistry } from "../ports/session-runtime";

/**
 * The kill switch, and shutdown: disposes every runtime Gravita runs (their Claude Code
 * processes end; pending prompts are answered as the runtime closes), waiting at most
 * `capMs`. Sessions running in a terminal have no runtime and are never touched.
 */
export class StopAllSessions {
  constructor(
    private readonly runtimes: SessionRuntimeRegistry,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly capMs: number,
  ) {}

  async execute(capMs = this.capMs): Promise<RpcResult<"engine.stopAll">> {
    const all = this.runtimes.all();
    if (!all.length) return { stopped: 0 };
    const disposing = all.map((r) =>
      r.dispose().catch((err) => this.logger.log("runtime dispose failed", err)),
    );
    let cancel = () => {};
    await Promise.race([
      Promise.allSettled(disposing),
      new Promise<void>((resolve) => {
        cancel = this.clock.setTimer(resolve, capMs);
      }),
    ]);
    cancel();
    return { stopped: all.length };
  }
}
