import type { Clock } from "../ports/clock";
import type { Logger } from "../ports/logger";
import type { ModelOption, SessionRuntimeRegistry } from "../ports/session-runtime";

/** Claude Code's model aliases, offered when no live session can list its models. */
export const FALLBACK_MODELS: readonly ModelOption[] = [
  { value: "default", displayName: "Default (recommended)" },
  { value: "opus", displayName: "Opus" },
  { value: "sonnet", displayName: "Sonnet" },
  { value: "haiku", displayName: "Haiku" },
];

const ASK_TIMEOUT_MS = 3_000;

/**
 * The models the user's Claude Code offers, asked of a live session; the last answer is
 * remembered, and the aliases stand in until there is one.
 */
export class ListModels {
  private known: ModelOption[] | undefined;

  constructor(
    private readonly runtimes: SessionRuntimeRegistry,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  async execute(): Promise<{ models: ModelOption[] }> {
    for (const runtime of this.runtimes.all()) {
      if (!runtime.supportedModels) continue;
      try {
        const models = await this.withTimeout(runtime.supportedModels());
        if (models?.length) {
          this.known = models.map((m) => ({ value: m.value, displayName: m.displayName }));
          break;
        }
      } catch (err) {
        this.logger.log("listing models failed", err);
      }
    }
    return { models: this.known ?? [...FALLBACK_MODELS] };
  }

  private withTimeout<T>(p: Promise<T>): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      const cancel = this.clock.setTimer(() => resolve(undefined), ASK_TIMEOUT_MS);
      p.then(
        (v) => {
          cancel();
          resolve(v);
        },
        (err) => {
          cancel();
          reject(err);
        },
      );
    });
  }
}
