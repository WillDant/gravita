import type { SessionKind, ToolKind } from "@gravita/protocol";

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
  ended: boolean;
  costUsd?: number;
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

export interface GravitaState {
  projects: Record<string, ProjectState>;
  sessions: Record<string, SessionState>;
  seq: number;
}

export function emptyState(): GravitaState {
  return { projects: {}, sessions: {}, seq: 0 };
}
