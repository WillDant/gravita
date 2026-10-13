import type { PermissionMode, Provider } from "@gravita/protocol";

export type PermissionDecision = "allow" | "deny";

export interface ModelOption {
  value: string;
  displayName: string;
}

/**
 * A session Gravita runs (the demo, or Claude Code through the Agent SDK) and can therefore
 * control. Each control capability is backed by its own use case. A runtime that can't do
 * something (the demo can't take a message) rejects with `NotControllableError`.
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
  /** Sends a user message; `uuid` is the id its `message.user` event was keyed with. */
  send(text: string, uuid: string): Promise<void>;
  /** Stops the current turn (the session stays open for the next message). */
  interrupt(): Promise<void>;
  /** Stops one subagent; the main agent means the current turn. */
  stopAgent(agentId: string): Promise<void>;
  /** Switches the model for the next turns ("default" restores Claude Code's default). */
  setModel(model: string): Promise<void>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  /** Answers a pending AskUserQuestion: question text → chosen label(s), or free text. */
  answerQuestion(
    agentId: string,
    requestId: string,
    answers: Record<string, string>,
    response?: string,
  ): Promise<void>;
  /** The models this runtime's agent offers, when it can tell. */
  supportedModels?(): Promise<ModelOption[]>;
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
