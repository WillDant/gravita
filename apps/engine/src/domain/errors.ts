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

/**
 * M2c: squads are in the protocol but not yet run by the engine. Every squad method
 * answers this until the orchestration lands; then this error goes away.
 */
export class SquadsUnavailableError extends Error {
  constructor() {
    super("Squads arrive in a later version");
    this.name = "SquadsUnavailableError";
  }
}

/** An existing repository has uncommitted or untracked changes; a squad needs a clean start. */
export class DirtyWorktreeError extends Error {
  constructor(readonly path: string) {
    super("Commit or stash your changes first");
    this.name = "DirtyWorktreeError";
  }
}

/** The squad's folder has files but isn't a git repository, so Gravita won't take it over. */
export class NotARepositoryError extends Error {
  constructor(readonly path: string) {
    super("This folder has files but isn't a git repository; pick an empty folder or a repository");
    this.name = "NotARepositoryError";
  }
}

/**
 * The repository isn't in a state the squad step needs (no commit yet, a detached HEAD, the
 * wrong branch checked out for delivery…). The message says what to do.
 */
export class SquadWorkspaceError extends Error {
  constructor(
    readonly reason:
      | "no-commits"
      | "detached-head"
      | "unknown-branch"
      | "wrong-branch"
      | "invalid-id"
      | "missing-contract",
    message: string,
  ) {
    super(message);
    this.name = "SquadWorkspaceError";
  }
}

/** A plan the engine can't run even though its shape is valid (e.g. a reserved role id). */
export class InvalidSquadPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSquadPlanError";
  }
}

/** Opening a pull request needs a remote and the GitHub CLI, installed and logged in. */
export class GhUnavailableError extends Error {
  constructor(readonly reason: "no-remote" | "not-installed" | "not-logged-in") {
    super(
      reason === "no-remote"
        ? "This repository has no remote to push to"
        : reason === "not-installed"
          ? "The GitHub CLI (gh) is not installed"
          : "The GitHub CLI (gh) is not logged in; run `gh auth login`",
    );
    this.name = "GhUnavailableError";
  }
}

/** A check that must not run: a program outside CHECK_PROGRAMS, or a cwd outside the worktree. */
export class CheckRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckRefusedError";
  }
}
