import type { EngineStatus, EventsNotification, GravitaEvent } from "@gravita/protocol";
import type { Clock } from "../ports/clock";
import type {
  EngineFeed,
  EngineListener,
  EventPublisher,
  StatusReporter,
} from "../ports/event-publisher";

/** Batching window for `events` notifications (~30 fps). */
export const FLUSH_MS = 33;

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
    initial: EngineStatus,
  ) {
    this.current = initial;
    this.lastStatusJson = JSON.stringify(initial);
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

  updateStatus(patch: Partial<EngineStatus>) {
    this.current = { ...this.current, ...patch };
    this.statusDirty = true;
    this.schedule();
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
