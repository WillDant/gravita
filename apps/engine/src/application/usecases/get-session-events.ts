import type { GravitaEvent } from "@gravita/protocol";
import type { EventStore } from "../ports/event-store";

/** Every stored event of one session, in seq order (for the line map). */
export class GetSessionEvents {
  constructor(private readonly store: EventStore) {}

  execute(sessionId: string): { events: GravitaEvent[] } {
    return { events: this.store.sessionEvents(sessionId) };
  }
}
