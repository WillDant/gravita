import { EPHEMERAL_EVENT_TYPES, type GravitaEvent } from "@gravita/protocol";
import type { EventPublisher } from "../ports/event-publisher";
import type { EventStore } from "../ports/event-store";
import type { ProjectionService } from "../services/projection-service";

/**
 * The engine's single write path: stores events (deduped by key), applies the ones that
 * are new to the projection, and publishes them. Ephemeral events (presence, control)
 * are applied and published but never stored.
 */
export class IngestEvents {
  private readonly listeners = new Set<(accepted: readonly GravitaEvent[]) => void>();

  constructor(
    private readonly store: EventStore,
    private readonly projection: ProjectionService,
    private readonly publisher: EventPublisher,
  ) {}

  /**
   * Returns the events that were new, in order. `alsoInTx` runs in the same transaction
   * (e.g. to persist a tail checkpoint together with the events it produced).
   */
  execute(events: readonly GravitaEvent[], alsoInTx?: () => void): GravitaEvent[] {
    const accepted: GravitaEvent[] = [];
    let seq = this.projection.seq;
    this.store.transaction(() => {
      for (const e of events) {
        if (EPHEMERAL_EVENT_TYPES.has(e.type)) {
          accepted.push(e);
          continue;
        }
        const stored = this.store.insert(e);
        if (stored === null) continue;
        seq = stored;
        accepted.push(e);
      }
      alsoInTx?.();
    });
    this.projection.apply(accepted, seq);
    if (accepted.length) {
      this.publisher.publish(accepted, seq);
      for (const l of this.listeners) l(accepted);
    }
    return accepted;
  }

  /**
   * Calls `listener` with every batch of new events, once they are in the projection, for
   * the engine's own reactions (a plan usage reading checks the budgets). A listener that
   * ingests in turn is called again for those events.
   */
  onAccepted(listener: (accepted: readonly GravitaEvent[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
