import { apply, emptyState, type GravitaState, type SessionState } from "@gravita/core";
import type { GravitaEvent } from "@gravita/protocol";
import type { ProjectionReader } from "../ports/projection-reader";

export interface Snapshot {
  seq: number;
  state: GravitaState;
}

/**
 * Owns the engine's in-memory GravitaState, built with the same reducer the UI uses.
 * Only `IngestEvents` mutates it; every read hands out a copy.
 */
export class ProjectionService implements ProjectionReader {
  private readonly state: GravitaState = emptyState();

  /** Rebuilds the projection from stored events (on start). */
  hydrate(events: Iterable<GravitaEvent>, seq: number) {
    for (const e of events) apply(this.state, e);
    this.state.seq = seq;
  }

  /** Applies events that were just accepted; `seq` is the highest persisted seq. */
  apply(events: readonly GravitaEvent[], seq: number) {
    this.state.seq = seq;
    for (const e of events) apply(this.state, e);
  }

  get seq(): number {
    return this.state.seq;
  }

  /** A deep copy of the whole state; mutating it never affects the engine. */
  snapshot(): Snapshot {
    return { seq: this.state.seq, state: structuredClone(this.state) };
  }

  session(sessionId: string): SessionState | undefined {
    const s = this.state.sessions[sessionId];
    return s ? structuredClone(s) : undefined;
  }
}
