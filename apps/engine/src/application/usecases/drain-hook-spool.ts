import type { HookSpool } from "../ports/hook-spool";
import type { Logger } from "../ports/logger";
import type { HookIngest } from "../services/hook-ingest";

/**
 * Ingests the hooks the plugin spooled while the engine was away, once each (their keys
 * make a second pass harmless). Runs at start and periodically; one pass at a time.
 */
export class DrainHookSpool {
  private running: Promise<number> | undefined;

  constructor(
    private readonly spool: HookSpool,
    private readonly hooks: HookIngest,
    private readonly logger: Logger,
  ) {}

  execute(): Promise<number> {
    this.running ??= this.spool
      .drain(async (payload) => {
        await this.hooks.execute(payload, { replay: true });
        // Stop before the spool is deleted: the next engine reads it again (keys dedupe).
        if (this.hooks.isClosed) throw new Error("the engine is stopping");
      })
      .catch((err) => {
        if (!this.hooks.isClosed) this.logger.log("hook spool drain failed", err);
        return 0;
      })
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }
}
