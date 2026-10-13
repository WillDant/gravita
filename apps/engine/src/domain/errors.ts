/** The session runs outside Gravita (e.g. a terminal), or its request can't be answered here. */
export class NotControllableError extends Error {
  constructor(readonly sessionId: string) {
    super(`Session ${sessionId} is not controlled by Gravita`);
    this.name = "NotControllableError";
  }
}

/** Claude Code isn't installed, wasn't found, or is older than Gravita supports. */
export class ClaudeUnavailableError extends Error {
  constructor(readonly reason: "not-found" | "outdated") {
    super(reason === "outdated" ? "Claude Code is outdated" : "Claude Code was not found");
    this.name = "ClaudeUnavailableError";
  }
}

/** The folder for a new session doesn't exist or isn't a directory. */
export class InvalidCwdError extends Error {
  constructor(readonly cwd: string) {
    super("The folder doesn't exist or isn't a directory");
    this.name = "InvalidCwdError";
  }
}

/** Starting another session would exceed `MAX_CHAT_SESSIONS`. */
export class TooManySessionsError extends Error {
  constructor(readonly limit: number) {
    super(`At most ${limit} sessions can run at once`);
    this.name = "TooManySessionsError";
  }
}

/** Claude Code reported it isn't logged in; the user runs /login in Claude Code itself. */
export class NotLoggedInError extends Error {
  constructor(readonly sessionId?: string) {
    super("Claude Code is not logged in");
    this.name = "NotLoggedInError";
  }
}

/**
 * Bypass mode skips every permission prompt. It can only be chosen when a session starts,
 * never switched on later, so an approval flow can't silently disappear mid-session.
 */
export class BypassLockedError extends Error {
  constructor(readonly sessionId: string) {
    super("Bypass mode can only be chosen when a session starts");
    this.name = "BypassLockedError";
  }
}

/** An answer to a question that picks nothing the question offered and has no free text. */
export class InvalidAnswerError extends Error {
  constructor(readonly requestId: string) {
    super("The answer doesn't match the question");
    this.name = "InvalidAnswerError";
  }
}
