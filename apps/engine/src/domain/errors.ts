import type { AgentProvider } from "@gravita/protocol";

/** The session runs outside Gravita (e.g. a terminal), or its request can't be answered here. */
export class NotControllableError extends Error {
  constructor(readonly sessionId: string) {
    super(`Session ${sessionId} is not controlled by Gravita`);
    this.name = "NotControllableError";
  }
}

/** A provider's CLI isn't installed, wasn't found, or is older than Gravita supports. */
export class ProviderUnavailableError extends Error {
  constructor(
    readonly provider: AgentProvider,
    readonly reason: "not-found" | "outdated",
  ) {
    super(
      `${provider === "codex" ? "Codex" : "Claude Code"} ${reason === "outdated" ? "is outdated" : "was not found"}`,
    );
    this.name = "ProviderUnavailableError";
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

/** A provider's CLI reported it isn't logged in; the user logs in there, never through Gravita. */
export class NotLoggedInError extends Error {
  constructor(
    readonly provider: AgentProvider,
    readonly sessionId?: string,
  ) {
    super(`${provider === "codex" ? "Codex" : "Claude Code"} is not logged in`);
    this.name = "NotLoggedInError";
  }
}

/** A session mode of another provider (a Codex mode for a Claude Code session, or back). */
export class InvalidSessionModeError extends Error {
  constructor(
    readonly provider: AgentProvider,
    readonly mode: string,
  ) {
    super(`${mode} is not a mode of ${provider} sessions`);
    this.name = "InvalidSessionModeError";
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

/** This engine doesn't run squads (the demo plays a scripted one instead). */
export class SquadsUnavailableError extends Error {
  constructor() {
    super("Squads run with Claude Code; the demo only plays a scripted one");
    this.name = "SquadsUnavailableError";
  }
}

/** No squad has this id. */
export class SquadNotFoundError extends Error {
  constructor(readonly squadId: string) {
    super(`No squad ${squadId}`);
    this.name = "SquadNotFoundError";
  }
}

/** The action doesn't fit where the squad is (approving while it builds, delivering early…). */
export class SquadPhaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SquadPhaseError";
  }
}

/** Starting (or resuming) one more squad would exceed how many may run at once. */
export class TooManySquadsError extends Error {
  constructor(readonly limit: number) {
    super(`At most ${limit} squads can run at once; pause or finish one first`);
    this.name = "TooManySquadsError";
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

/**
 * A squad's budget is a share of the plan, but the account has no plan limits (an API key,
 * Bedrock, Vertex): there is no share to take, so the budget must be in dollars.
 */
export class PlanUsageUnavailableError extends Error {
  constructor(readonly provider: AgentProvider) {
    super(
      `Your ${provider === "codex" ? "Codex" : "Claude"} account has no plan usage limits (it uses an API key), so a squad can't take a share of a plan. Give the squad a dollar budget instead.`,
    );
    this.name = "PlanUsageUnavailableError";
  }
}
