import type { GravitaEvent, Provider } from "@gravita/protocol";
import type { CheckpointStore, SavedTail } from "../src/application/ports/checkpoint-store";
import type { Clock } from "../src/application/ports/clock";
import type { EventPublisher } from "../src/application/ports/event-publisher";
import type { EventStore } from "../src/application/ports/event-store";
import type { Logger } from "../src/application/ports/logger";
import type { PermissionDecision, SessionRuntime } from "../src/application/ports/session-runtime";

// In-memory fakes of the application ports, for use-case tests without SQLite or sockets.

export class FakeClock implements Clock {
  private timers: { at: number; fn: () => void; cancelled: boolean }[] = [];

  constructor(public t = Date.parse("2026-10-12T10:00:00.000Z")) {}

  now(): number {
    return this.t;
  }

  iso(): string {
    return new Date(this.t).toISOString();
  }

  setTimer(fn: () => void, ms: number): () => void {
    const timer = { at: this.t + ms, fn, cancelled: false };
    this.timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  }

  /** Moves time forward and runs the timers that came due. */
  advance(ms: number) {
    this.t += ms;
    const due = this.timers.filter((x) => !x.cancelled && x.at <= this.t);
    this.timers = this.timers.filter((x) => !due.includes(x));
    for (const x of due) x.fn();
  }

  pendingTimers(): number {
    return this.timers.filter((x) => !x.cancelled).length;
  }
}

export class MemoryEventStore implements EventStore {
  readonly rows: GravitaEvent[] = [];
  /** Labels of what ran inside a transaction, in order. */
  readonly txLog: string[] = [];
  inTx = false;

  insert(e: GravitaEvent): number | null {
    if (this.rows.some((r) => r.key === e.key)) return null;
    this.rows.push(e);
    if (this.inTx) this.txLog.push(`insert:${e.key}`);
    return this.rows.length;
  }

  transaction<T>(fn: () => T): T {
    this.inTx = true;
    try {
      return fn();
    } finally {
      this.inTx = false;
    }
  }

  maxSeq(): number {
    return this.rows.length;
  }

  allEvents(): Iterable<GravitaEvent> {
    return this.rows;
  }

  sessionEvents(sessionId: string): GravitaEvent[] {
    return this.rows.filter((e) => e.sessionId === sessionId);
  }
}

/** A checkpoint store that writes into the event store's transaction log. */
export class MemoryCheckpointStore implements CheckpointStore {
  readonly saved = new Map<string, SavedTail>();

  constructor(private readonly tx: MemoryEventStore) {}

  load(sessionId: string): SavedTail | undefined {
    return this.saved.get(sessionId);
  }

  save(sessionId: string, tail: SavedTail) {
    this.tx.txLog.push(this.tx.inTx ? `checkpoint:${sessionId}` : `checkpoint-outside-tx`);
    this.saved.set(sessionId, tail);
  }
}

export class RecordingPublisher implements EventPublisher {
  readonly batches: { keys: string[]; seq: number }[] = [];

  publish(events: readonly GravitaEvent[], seq: number) {
    this.batches.push({ keys: events.map((e) => e.key), seq });
  }
}

export class SilentLogger implements Logger {
  readonly lines: string[] = [];

  log(message: string) {
    this.lines.push(message);
  }
}

export class FakeRuntime implements SessionRuntime {
  readonly answered: { agentId: string; requestId: string; decision: PermissionDecision }[] = [];
  disposed = false;

  constructor(
    readonly sessionId: string,
    readonly projectId = "p1",
    readonly provider: Provider = "claude",
  ) {}

  async respondPermission(agentId: string, requestId: string, decision: PermissionDecision) {
    this.answered.push({ agentId, requestId, decision });
  }

  async dispose() {
    this.disposed = true;
  }
}
