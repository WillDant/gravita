import type { Provider } from "@gravita/protocol";

export type PermissionDecision = "allow" | "deny";

/**
 * A session Gravita runs (the demo now; the Agent SDK in M1b) and can therefore control.
 * Control capabilities are added here as methods as each one ships (M1b: send,
 * interrupt, stopAgent, setPermissionMode, setModel, answerQuestion), each backed by
 * its own use case.
 */
export interface SessionRuntime {
  readonly sessionId: string;
  readonly projectId: string;
  readonly provider: Provider;
  /**
   * Answers a pending permission request. Rejects with `NotControllableError` when the
   * request can't be answered (unknown, or no longer pending).
   */
  respondPermission(
    agentId: string,
    requestId: string,
    decision: PermissionDecision,
  ): Promise<void>;
  /** Releases whatever the runtime holds (processes, streams). */
  dispose(): Promise<void>;
}

/** Whether some runtime owns a session, so other sources leave it alone (one writer). */
export interface SessionOwnership {
  isOwned(sessionId: string): boolean;
}

/**
 * Runtimes by session. Registering and unregistering announce the change to clients
 * (`session.control`), so the UI knows which sessions it may control.
 */
export interface SessionRuntimeRegistry extends SessionOwnership {
  register(runtime: SessionRuntime): void;
  unregister(sessionId: string): void;
  get(sessionId: string): SessionRuntime | undefined;
  all(): SessionRuntime[];
}
