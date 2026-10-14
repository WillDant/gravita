import type {
  AgentProvider,
  PermissionMode,
  Question,
  SessionKind,
  SessionMode,
  ToolKind,
  UsageAccount,
  UsageWindow,
} from "@gravita/protocol";
import type { SquadState } from "./squad/state";

/**
 * Persistent lifecycle of an agent node. Activity (what it's doing right now) is
 * derived separately in status.ts from in-flight tools and timing.
 */
export type Lifecycle =
  | "queued"
  | "active"
  | "idle" // main agent finished its turn and waits for the next prompt
  | "waiting_user"
  | "paused"
  | "blocked"
  | "done"
  | "failed"
  | "stopped"
  | "detached";

export const TERMINAL: ReadonlySet<Lifecycle> = new Set(["done", "failed", "stopped"]);

export interface InflightTool {
  toolUseId: string;
  name: string;
  kind: ToolKind;
  target: { path?: string; cmd?: string; url?: string; query?: string; agentType?: string };
  inputPreview: string;
  startedTs: string;
}

export interface Tokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const ZERO_TOKENS: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export interface AgentNode {
  id: string;
  sessionId: string;
  parentId: string | null;
  depth: number;
  /** "main" for the session's main agent, otherwise the subagent type (Explore, Plan…). */
  agentType: string;
  description?: string;
  background: boolean;
  model?: string;
  lifecycle: Lifecycle;
  createdTs: string;
  lastEventTs: string;
  lastTalkTs?: string;
  inflight: Record<string, InflightTool>;
  lastTool?: InflightTool;
  toolCount: number;
  filesTouched: string[];
  tokens: Tokens;
  /** Last progress summary or completion summary, plain language when available. */
  summary?: string;
  children: string[];
  pendingPermissions: string[];
  /** What each pending request asks for, by request id. */
  permissions: Record<string, PermissionRequest>;
  /** Questions this agent is waiting on the user to answer, by request id. */
  questions: Record<string, PendingQuestion>;
}

export interface PendingQuestion {
  requestId: string;
  questions: Question[];
  ts: string;
}

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  inputPreview: string;
  ts: string;
}

export interface SessionState {
  id: string;
  projectId: string;
  provider: string;
  kind: SessionKind;
  cwd: string;
  gitBranch?: string;
  title?: string;
  firstUserText?: string;
  startedTs: string;
  lastEventTs: string;
  presence?: "busy" | "idle" | "waiting";
  live: boolean;
  /** Gravita runs this session and can answer, interrupt or message it. */
  controllable: boolean;
  /** Model and permission mode, for sessions Gravita runs. */
  model?: string;
  permissionMode?: PermissionMode;
  /** The mode in the provider's own terms, when Claude Code's lose it (Cursor's ask). */
  providerMode?: SessionMode;
  ended: boolean;
  costUsd?: number;
  /** Set on a squad role's session: the squad, role and task it works for. */
  squadId?: string;
  roleId?: string;
  taskId?: string;
  agents: Record<string, AgentNode>;
  /** Per agent → per message usage, so repeated usage records are counted once (max). */
  usage: Record<string, Record<string, Tokens>>;
  version: number;
}

export interface ProjectState {
  id: string;
  name: string;
  root: string;
  sessionIds: string[];
  lastEventTs: string;
}

/** The latest reading of one plan usage window (see the `usage.limits` event). */
export interface UsageLimitState {
  provider: AgentProvider;
  /** Absent for the user's own account; `squadProfile` for Gravita's Codex profile. */
  account?: UsageAccount;
  window: UsageWindow;
  model?: string;
  /** 0–100, account-wide. */
  usedPercent: number;
  resetsAt?: string;
  planType?: string;
  status?: "allowed" | "warning" | "rejected";
  /** When it was read. */
  ts: string;
}

export interface GravitaState {
  projects: Record<string, ProjectState>;
  sessions: Record<string, SessionState>;
  squads: Record<string, SquadState>;
  /** Plan usage by `usageKey` (provider, window and model), latest reading each. */
  usage: Record<string, UsageLimitState>;
  seq: number;
}

export function emptyState(): GravitaState {
  return { projects: {}, sessions: {}, squads: {}, usage: {}, seq: 0 };
}

/**
 * The key of a plan usage window in `GravitaState.usage`: "claude:five_hour" for the user's
 * own account, "codex:squadProfile:five_hour" for Gravita's Codex profile.
 */
export function usageKey(
  provider: string,
  window: string,
  model?: string,
  account?: UsageAccount,
): string {
  const head = account ? `${provider}:${account}` : provider;
  return model ? `${head}:${window}:${model}` : `${head}:${window}`;
}
