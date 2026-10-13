// Zod-free runtime constants, so the UI bundle doesn't pull in schema code.

export const RPC_VERSION = 1;

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

export const RpcErrors = {
  unauthorized: { code: 4001, message: "Unauthorized" },
  badRequest: { code: -32600, message: "Invalid request" },
  methodNotFound: { code: -32601, message: "Method not found" },
  /** The session runs outside Gravita (e.g. a terminal); answer it there. */
  notControllable: { code: 4004, message: "This session is not controlled by Gravita" },
  /** Claude Code isn't installed, or is older than Gravita supports. */
  claudeUnavailable: { code: 4005, message: "Claude Code is not available" },
  /** The folder doesn't exist or isn't a directory. */
  invalidCwd: { code: 4006, message: "That folder doesn't exist" },
  tooManySessions: { code: 4007, message: "Too many sessions are running" },
  /** Claude Code isn't logged in; the user runs /login in Claude Code itself. */
  notLoggedIn: { code: 4008, message: "Claude Code is not logged in" },
  squadNotFound: { code: 4009, message: "No such squad" },
  /** The plan breaks a rule (overlapping ownership, a task writing outside its role…). */
  invalidPlan: { code: 4010, message: "The plan is not valid" },
  /** The action doesn't fit the squad's phase (e.g. approving while it's building). */
  squadPhase: { code: 4011, message: "The squad can't do that right now" },
  /** An existing repository must have a clean working tree before a squad starts. */
  dirtyWorktree: { code: 4012, message: "Commit or stash your changes first" },
  /** Opening a pull request needs the GitHub CLI (gh), installed and logged in. */
  ghUnavailable: { code: 4013, message: "The GitHub CLI is not available" },
} as const;
