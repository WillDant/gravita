import type { EngineStatus, EventsNotification, GravitaEvent } from "@gravita/protocol";

/** Sends newly applied events to whoever listens (batched by the implementation). */
export interface EventPublisher {
  /** `seq` is the highest persisted seq once these events are applied. */
  publish(events: readonly GravitaEvent[], seq: number): void;
}

/** The engine's status (CLI detection, indexing progress), broadcast when it changes. */
export interface StatusReporter {
  status(): EngineStatus;
  updateStatus(patch: Partial<EngineStatus>): void;
}

export interface EngineListener {
  events?: (n: EventsNotification) => void;
  status?: (s: EngineStatus) => void;
}

/** What a transport subscribes to. */
export interface EngineFeed {
  listen(l: EngineListener): () => void;
  /** Delivers what is pending now. */
  flush(): void;
}
