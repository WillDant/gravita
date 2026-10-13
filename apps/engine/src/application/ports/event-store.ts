import type { GravitaEvent } from "@gravita/protocol";

/**
 * Append-only event log. Idempotency keys are unique, so re-reading a transcript or
 * receiving the same fact from two sources stores it once.
 */
export interface EventStore {
  /** Stores the event unless its key exists. Returns its seq, or null for a duplicate. */
  insert(e: GravitaEvent): number | null;
  /**
   * Runs `fn` atomically. Stores that share the same database (the checkpoint store)
   * write inside the same transaction.
   */
  transaction<T>(fn: () => T): T;
  maxSeq(): number;
  allEvents(): Iterable<GravitaEvent>;
  /** Every stored event of one session, in seq order. */
  sessionEvents(sessionId: string): GravitaEvent[];
}
