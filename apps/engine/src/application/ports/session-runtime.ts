import type { ConversationMessage, Provider, SessionKind, SessionMode } from "@gravita/protocol";

export type PermissionDecision = "allow" | "deny";

export interface ModelOption {
  value: string;
  displayName: string;
}

/**
 * A session Gravita runs (the demo, or a provider's agent such as Claude Code through the
 * Agent SDK) and can therefore
 * control. Each control capability is backed by its own use case. A runtime that can't do
 * something (the demo can't take a message) rejects with `NotControllableError`.
 */
export interface SessionRuntime {
  readonly sessionId: string;
  readonly projectId: string;
  readonly provider: Provider;
  /** "squad" for a squad's planner and role sessions; chats (and the demo) leave it out. */
  readonly kind?: SessionKind;
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
  /** `mode` is one of the runtime's provider's modes (the use case checks it first). */
  setPermissionMode(mode: SessionMode): Promise<void>;
  /** Answers a pending AskUserQuestion: question text → chosen label(s), or free text. */
  answerQuestion(
    agentId: string,
    requestId: string,
    answers: Record<string, string>,
    response?: string,
  ): Promise<void>;
  /** The models this runtime's agent offers, when it can tell. */
  supportedModels?(): Promise<ModelOption[]>;
  /** Full message text for the Conversation lens (Cursor keeps this in memory). */
  conversation?(): readonly ConversationMessage[];
  /** Releases whatever the runtime holds (processes, streams). */
  dispose(): Promise<void>;
}

/** Whether some runtime owns a session, so other sources leave it alone (one writer). */
export interface SessionOwnership {
  isOwned(sessionId: string): boolean;
}

/** A runtime still opening (its agent hasn't named the session yet), held by the registry. */
export interface OpeningRuntime {
  /** The kill switch stopped it while it opened: it must not register nor send anything. */
  readonly cancelled: boolean;
  /** It opened (or failed to): the registry lets go of it. */
  done(): void;
}

/**
 * Runtimes by session. Registering and unregistering announce the change to clients
 * (`session.control`), so the UI knows which sessions it may control.
 */
export interface SessionRuntimeRegistry extends SessionOwnership {
  /**
   * Holds a runtime from its `open()` until it registers, so the kill switch stops it too
   * (opening Codex takes seconds). Nothing is announced: it has no session id yet.
   */
  opening(runtime: SessionRuntime): OpeningRuntime;
  /** The runtimes still opening, each marked cancelled (the kill switch disposes them). */
  cancelOpening(): SessionRuntime[];
  register(runtime: SessionRuntime): void;
  /**
   * Forgets the session's runtime. With `runtime`, only if it is still that one: a session
   * resumed under the same id may already have a new runtime when the old one winds down.
   */
  unregister(sessionId: string, runtime?: SessionRuntime): void;
  get(sessionId: string): SessionRuntime | undefined;
  all(): SessionRuntime[];
}
