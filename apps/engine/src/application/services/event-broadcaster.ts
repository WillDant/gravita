import type {
  AgentProvider,
  EngineStatus,
  EventsNotification,
  GravitaEvent,
  ProviderStatus,
} from "@gravita/protocol";
import type { Clock } from "../ports/clock";
import type {
  EngineFeed,
  EngineListener,
  EventPublisher,
  StatusReporter,
} from "../ports/event-publisher";

/** Batching window for `events` notifications (~30 fps). */
export const FLUSH_MS = 33;

/** Claude Code's status before detection says otherwise. */
const CLAUDE_UNKNOWN: ProviderStatus = { found: false };

/**
 * The engine's first status. Providers may be given either way: under `providers`, or (as
 * before providers existed) as `claude` alone.
 */
export type InitialStatus = Omit<EngineStatus, "providers" | "claude"> & {
  providers?: EngineStatus["providers"];
  claude?: ProviderStatus;
};

/**
 * A status whose deprecated `claude` alias equals `providers.claude`, so a UI that predates
 * providers keeps reading Claude Code's status where it always did.
 */
export function withClaudeAlias(s: InitialStatus): EngineStatus {
  const claude = s.providers?.claude ?? s.claude ?? CLAUDE_UNKNOWN;
  return { ...s, providers: { ...s.providers, claude }, claude };
}

/**
 * Batches applied events into `events` notifications and broadcasts status changes,
 * skipping a status that serializes the same as the last one sent.
 */
export class EventBroadcaster implements EventPublisher, StatusReporter, EngineFeed {
  private current: EngineStatus;
  private pending: GravitaEvent[] = [];
  private seq = 0;
  private statusDirty = false;
  private lastStatusJson: string;
  private cancelTimer: (() => void) | undefined;
  private readonly listeners = new Set<EngineListener>();

  constructor(
    private readonly clock: Clock,
    initial: InitialStatus,
  ) {
    this.current = withClaudeAlias(initial);
    this.lastStatusJson = JSON.stringify(this.current);
  }

  publish(events: readonly GravitaEvent[], seq: number) {
    this.seq = seq;
    if (!events.length) return;
    for (const e of events) this.pending.push(e);
    this.schedule();
  }

  status(): EngineStatus {
    return this.current;
  }

  updateStatus(patch: Partial<Omit<EngineStatus, "providers" | "claude">>) {
    this.current = { ...this.current, ...patch };
    this.statusDirty = true;
    this.schedule();
  }

  updateProvider(provider: AgentProvider, patch: Partial<ProviderStatus>) {
    const before = this.current.providers[provider] ?? { found: false };
    const providers = { ...this.current.providers, [provider]: { ...before, ...patch } };
    this.current = withClaudeAlias({ ...this.current, providers });
    this.statusDirty = true;
    this.schedule();
  }

  providerStatus(provider: AgentProvider): ProviderStatus | undefined {
    return this.current.providers[provider];
  }

  listen(l: EngineListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  flush() {
    this.cancelTimer?.();
    this.cancelTimer = undefined;
    if (this.pending.length) {
      const n: EventsNotification = { seq: this.seq, events: this.pending };
      this.pending = [];
      for (const l of this.listeners) l.events?.(n);
    }
    if (this.statusDirty) {
      this.statusDirty = false;
      const json = JSON.stringify(this.current);
      if (json !== this.lastStatusJson) {
        this.lastStatusJson = json;
        for (const l of this.listeners) l.status?.(this.current);
      }
    }
  }

  close() {
    this.cancelTimer?.();
    this.cancelTimer = undefined;
    this.listeners.clear();
  }

  private schedule() {
    this.cancelTimer ??= this.clock.setTimer(() => {
      this.cancelTimer = undefined;
      this.flush();
    }, FLUSH_MS);
  }
}
