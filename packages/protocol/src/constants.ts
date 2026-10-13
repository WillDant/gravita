// Zod-free runtime constants, so the UI bundle doesn't pull in schema code.

export const RPC_VERSION = 1;

/** The coding agents Gravita observes and runs. Events also carry "gravita" and "fake". */
export const AGENT_PROVIDERS = ["claude", "codex"] as const;
export type AgentProvider = (typeof AGENT_PROVIDERS)[number];

/** The provider of a session or a request that names none (everything before Codex). */
export const DEFAULT_PROVIDER: AgentProvider = "claude";

/** Claude Code's permission modes. */
export const CLAUDE_MODES = ["default", "acceptEdits", "plan", "bypassPermissions"] as const;
/** Codex's session modes: ask before acting, write in the workspace, or full access. */
export const CODEX_MODES = ["ask", "workspace", "fullAccess"] as const;

/**
 * The plan usage windows a provider reports: the 5-hour and weekly limits, a weekly limit
 * of one model family (`model` names it), or anything else the provider counts.
 */
export const USAGE_WINDOWS = ["five_hour", "seven_day", "seven_day_model", "other"] as const;
export type UsageWindow = (typeof USAGE_WINDOWS)[number];

/** The windows a squad's budget can be a share of. */
export const PLAN_WINDOWS = ["five_hour", "seven_day"] as const;
export type PlanWindow = (typeof PLAN_WINDOWS)[number];

/** Whether plan limits apply to an account (`limited`) or it pays per token (`api`). */
export const ACCOUNT_PLANS = ["limited", "api"] as const;
export type AccountPlan = (typeof ACCOUNT_PLANS)[number];

export const Methods = {
  auth: "auth",
  snapshot: "state.snapshot",
  status: "engine.status",
  sessionEvents: "session.events",
  permissionRespond: "permission.respond",
  sessionStart: "session.start",
  sessionSend: "session.send",
  sessionInterrupt: "session.interrupt",
  agentStop: "agent.stop",
  sessionSetModel: "session.setModel",
  sessionSetPermissionMode: "session.setPermissionMode",
  questionAnswer: "question.answer",
  sessionConversation: "session.conversation",
  modelsList: "models.list",
  /** @deprecated Use `modelsList` with `{ provider: "claude" }`; kept for older clients. */
  claudeModels: "claude.models",
  stopAll: "engine.stopAll",
  squadCreate: "squad.create",
  squadPlan: "squad.plan",
  squadReplan: "squad.replan",
  squadApprovePlan: "squad.approvePlan",
  squadPause: "squad.pause",
  squadResume: "squad.resume",
  squadStop: "squad.stop",
  squadTaskRetry: "squad.task.retry",
  squadTaskSkip: "squad.task.skip",
  squadTaskReassign: "squad.task.reassign",
  squadDeliver: "squad.deliver",
  usageRefresh: "usage.refresh",
} as const;

/**
 * Plain HTTP routes next to the WebSocket, for callers that aren't the UI:
 * - `stopAll`: the tray's kill switch (POST, `Authorization: Bearer <engine token>`).
 * - `hooks`: Deep Observe hook events (POST, `Authorization: Bearer <hook token>` from
 *   the runtime file). Both refuse any request carrying an `Origin` header, so a web
 *   page can never reach them.
 */
export const HttpPaths = {
  stopAll: "/control/stop-all",
  hooks: "/hooks",
} as const;

/** Written by the engine (mode 0600) so Deep Observe hooks can find it: `<data dir>/runtime.json`. */
export interface RuntimeFile {
  port: number;
  hookToken: string;
  pid: number;
  version: string;
}

export const Notifications = {
  events: "events",
  status: "engine.status",
} as const;

/**
 * The JSON-RPC `data` of an error about one provider (`providerUnavailable`, `notLoggedIn`):
 * the message is provider-neutral and the client words it for the provider named here.
 */
export interface ProviderErrorData {
  provider: AgentProvider;
}

const providerUnavailable = { code: 4005, message: "The coding agent is not available" } as const;

export const RpcErrors = {
  unauthorized: { code: 4001, message: "Unauthorized" },
  badRequest: { code: -32600, message: "Invalid request" },
  methodNotFound: { code: -32601, message: "Method not found" },
  /** The session runs outside Gravita (e.g. a terminal); answer it there. */
  notControllable: { code: 4004, message: "This session is not controlled by Gravita" },
  /**
   * The provider's CLI isn't installed, or is older than Gravita supports. `data` is
   * `ProviderErrorData`.
   */
  providerUnavailable,
  /** @deprecated The same error as `providerUnavailable` (one code for every provider). */
  claudeUnavailable: providerUnavailable,
  /** The folder doesn't exist or isn't a directory. */
  invalidCwd: { code: 4006, message: "That folder doesn't exist" },
  tooManySessions: { code: 4007, message: "Too many sessions are running" },
  /**
   * The provider's CLI isn't logged in; the user logs in there (Gravita never does it for
   * them). `data` is `ProviderErrorData`.
   */
  notLoggedIn: { code: 4008, message: "The coding agent is not logged in" },
  squadNotFound: { code: 4009, message: "No such squad" },
  /** The plan breaks a rule (overlapping ownership, a task writing outside its role…). */
  invalidPlan: { code: 4010, message: "The plan is not valid" },
  /** The action doesn't fit the squad's phase (e.g. approving while it's building). */
  squadPhase: { code: 4011, message: "The squad can't do that right now" },
  /** An existing repository must have a clean working tree before a squad starts. */
  dirtyWorktree: { code: 4012, message: "Commit or stash your changes first" },
  /** Opening a pull request needs the GitHub CLI (gh), installed and logged in. */
  ghUnavailable: { code: 4013, message: "The GitHub CLI is not available" },
  /**
   * A squad's budget is a share of the plan, but the account has no plan limits (an API
   * key): there is nothing to take a share of, so the budget must be in dollars.
   */
  planUsageUnavailable: {
    code: 4014,
    message: "This account has no plan usage limits; use a dollar budget",
  },
} as const;
