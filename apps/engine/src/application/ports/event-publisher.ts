import type {
  AgentProvider,
  EngineStatus,
  EventsNotification,
  GravitaEvent,
  ProviderStatus,
} from "@gravita/protocol";

/** Sends newly applied events to whoever listens (batched by the implementation). */
export interface EventPublisher {
  /** `seq` is the highest persisted seq once these events are applied. */
  publish(events: readonly GravitaEvent[], seq: number): void;
}

/** The engine's status (CLI detection, indexing progress), broadcast when it changes. */
export interface StatusReporter {
  status(): EngineStatus;
  /** Patches the engine-wide fields; providers change through `updateProvider`. */
  updateStatus(patch: Partial<Omit<EngineStatus, "providers" | "claude">>): void;
  /** Merges `patch` into one provider's status (and its deprecated alias, for Claude). */
  updateProvider(provider: AgentProvider, patch: Partial<ProviderStatus>): void;
  /** One provider's status, or undefined when it hasn't been detected. */
  providerStatus(provider: AgentProvider): ProviderStatus | undefined;
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
