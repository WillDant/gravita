import { type AgentProvider, DEFAULT_PROVIDER } from "@gravita/protocol";
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

/** What each provider offers before a live session can tell (none known: an empty list). */
export const DEFAULT_FALLBACKS: Readonly<Partial<Record<AgentProvider, readonly ModelOption[]>>> = {
  claude: FALLBACK_MODELS,
  // Cursor's own list comes with a session; before one runs, Auto is always there.
  cursor: [{ value: "default", displayName: "Auto" }],
};

const ASK_TIMEOUT_MS = 3_000;

/** Where a provider's models can be read without a session of it running (Codex's probe). */
export type ModelCatalogs = Readonly<
  Partial<Record<AgentProvider, () => Promise<readonly ModelOption[]>>>
>;

/**
 * The models a provider offers, asked of a live session of that provider, else of its
 * catalog; the last answer per provider is remembered, and the provider's fallbacks stand
 * in until there is one.
 */
export class ListModels {
  private readonly known = new Map<AgentProvider, ModelOption[]>();

  constructor(
    private readonly runtimes: SessionRuntimeRegistry,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly fallbacks: Readonly<
      Partial<Record<AgentProvider, readonly ModelOption[]>>
    > = DEFAULT_FALLBACKS,
    private readonly catalogs: ModelCatalogs = {},
  ) {}

  async execute(provider: AgentProvider = DEFAULT_PROVIDER): Promise<{ models: ModelOption[] }> {
    for (const runtime of this.runtimes.all()) {
      if (runtime.provider !== provider || !runtime.supportedModels) continue;
      try {
        const models = await this.withTimeout(runtime.supportedModels());
        if (models?.length) {
          this.known.set(
            provider,
            models.map((m) => ({ value: m.value, displayName: m.displayName })),
          );
          break;
        }
      } catch (err) {
        this.logger.log("listing models failed", err);
      }
    }
    const catalog = this.catalogs[provider];
    if (!this.known.has(provider) && catalog) {
      try {
        const models = await this.withTimeout(catalog());
        if (models?.length) this.known.set(provider, [...models]);
      } catch (err) {
        this.logger.log("reading the model catalog failed", err);
      }
    }
    return { models: this.known.get(provider) ?? [...(this.fallbacks[provider] ?? [])] };
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
