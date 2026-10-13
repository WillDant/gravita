import { apply, emptyState, type GravitaState } from "@gravita/core";
import type {
  EngineStatus,
  EventsNotification,
  GravitaEvent,
  GravitaEventType,
  PermissionRespondParams,
} from "@gravita/protocol";
import type { Store } from "./store";

/** Live-only facts: applied to the projection and broadcast, never stored. */
export const EPHEMERAL: ReadonlySet<GravitaEventType> = new Set([
  "session.presence",
  "session.detached",
]);

/** Batching window for `events` notifications (~30 fps). */
export const FLUSH_MS = 33;

export interface HubListener {
  events?: (n: EventsNotification) => void;
  status?: (s: EngineStatus) => void;
}

/**
 * The engine's single writer: stores events (deduped by key), applies the ones that
 * are new to the in-memory projection, and broadcasts them in small batches.
 */
export class Hub {
  readonly state: GravitaState;
  private status: EngineStatus;
  private pending: GravitaEvent[] = [];
  private statusDirty = false;
  private lastStatusJson = "";
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly listeners = new Set<HubListener>();

  constructor(
    readonly store: Store,
    opts: { demo: boolean },
  ) {
    this.state = emptyState();
    for (const e of store.allEvents()) apply(this.state, e);
    this.state.seq = store.maxSeq();
    this.status = { claude: { found: false }, indexing: { done: 0, total: 0 }, demo: opts.demo };
    this.lastStatusJson = JSON.stringify(this.status);
  }

  /**
   * Stores and applies events, in order. `alsoInTx` runs in the same transaction
   * (e.g. to persist a tail checkpoint with the events it produced).
   * Returns the events that were new.
   */
  /**
   * Answers a pending permission request. Set by whichever runner controls the session
   * (the demo scenario now; the Agent SDK runner in M1). External sessions can't be
   * answered from here: their prompt lives in the user's terminal.
   */
  permissionResponder?: (p: PermissionRespondParams) => boolean;

  respondPermission(p: PermissionRespondParams): boolean {
    return this.permissionResponder?.(p) ?? false;
  }

  ingest(events: GravitaEvent[], alsoInTx?: () => void): GravitaEvent[] {
    const accepted: GravitaEvent[] = [];
    this.store.transaction(() => {
      for (const e of events) {
        if (EPHEMERAL.has(e.type)) {
          accepted.push(e);
          continue;
        }
        const seq = this.store.insert(e);
        if (seq === null) continue;
        this.state.seq = seq;
        accepted.push(e);
      }
      alsoInTx?.();
    });
    for (const e of accepted) apply(this.state, e);
    if (accepted.length) {
      for (const e of accepted) this.pending.push(e);
      this.schedule();
    }
    return accepted;
  }

  getStatus(): EngineStatus {
    return this.status;
  }

  updateStatus(patch: Partial<EngineStatus>) {
    this.status = { ...this.status, ...patch };
    this.statusDirty = true;
    this.schedule();
  }

  listen(l: HubListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Sends what is pending first, so a snapshot and the batches after it never overlap. */
  snapshot(): { seq: number; state: GravitaState } {
    this.flush();
    return { seq: this.state.seq, state: this.state };
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.pending.length) {
      const n: EventsNotification = { seq: this.state.seq, events: this.pending };
      this.pending = [];
      for (const l of this.listeners) l.events?.(n);
    }
    if (this.statusDirty) {
      this.statusDirty = false;
      const json = JSON.stringify(this.status);
      if (json !== this.lastStatusJson) {
        this.lastStatusJson = json;
        for (const l of this.listeners) l.status?.(this.status);
      }
    }
  }

  close() {
    clearTimeout(this.timer);
    this.listeners.clear();
  }

  private schedule() {
    this.timer ??= setTimeout(() => this.flush(), FLUSH_MS);
  }
}
