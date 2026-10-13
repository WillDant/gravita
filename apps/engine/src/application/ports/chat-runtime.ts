import type { AgentProvider, SessionKind, SessionMode } from "@gravita/protocol";
import type { GuardedCall } from "@gravita/protocol/tools";
import type { ZodRawShape } from "zod";
import type { SubagentPolicy } from "../../domain/squad-policy";
import type { AgentEnvironment } from "./agent-environment";
import type { SessionRuntime } from "./session-runtime";

// The runtime of a session Gravita starts: a chat, or a squad's planner or role session, on
// one provider. Squad sessions add tools, a tool guard and limits; everything here is plain
// data and functions, and each provider's infrastructure turns it into its own options (the
// Agent SDK's for Claude Code).

/**
 * The modes a session can start in, in its provider's terms. `dontAsk` (deny whatever
 * would prompt) is Gravita's own: the planner uses it, the UI never offers it.
 */
export type RuntimePermissionMode = SessionMode | "dontAsk";

/**
 * What a planning session may do, whatever its provider calls its tools: `read-only`
 * reads the repository and nothing else (the planner); `read-and-ask` may also ask the
 * user (the briefing). Each runtime turns it into its own tool restrictions and answers
 * the permission prompts itself.
 */
export type SessionAccess = "read-only" | "read-and-ask";

/** What a role tool answers the agent: text, flagged when the call failed. */
export interface ToolReply {
  text: string;
  isError?: boolean;
}

/** A tool Gravita offers a squad session (the in-process `gravita` MCP server). */
export interface RoleTool {
  name: string;
  description: string;
  /** zod 4 raw shape of the arguments. */
  input: ZodRawShape;
  handler(args: Record<string, unknown>): Promise<ToolReply>;
}

/**
 * A veto that runs before every tool call (subagents' calls included), on the provider-
 * neutral call: a reason denies it, undefined lets it through.
 */
export type ToolGuard = (call: GuardedCall) => string | undefined;

export type PermissionVerdict = "allow" | "ask" | "deny";

/** Decides a permission prompt before it reaches the user: allow, deny, or ask them. */
export type PermissionPolicy = (call: GuardedCall) => PermissionVerdict;

export interface ChatRuntimeSpec {
  sessionId: string;
  projectId: string;
  /** Which agent runs the session; the factory and the environment are that provider's. */
  provider: AgentProvider;
  cwd: string;
  model?: string;
  permissionMode: RuntimePermissionMode;
  environment: AgentEnvironment;
  /** "chat" when absent. */
  kind?: SessionKind;
  /** Set on a squad's sessions. */
  squad?: { squadId: string; roleId?: string; taskId?: string };
  /** Appended to the agent's own system prompt (a role's charter). */
  systemPromptAppend?: string;
  /** A planning session's restrictions; absent, the session has the agent's usual tools. */
  access?: SessionAccess;
  /** How the session's subagents run (squad sessions). */
  subagents?: SubagentPolicy;
  maxBudgetUsd?: number;
  maxTurns?: number;
  /** JSON Schema of the final answer (structured output). */
  outputSchema?: Record<string, unknown>;
  /** Continue the existing session `sessionId` (its transcript) instead of starting it. */
  resume?: boolean;
  /** Extra environment variables, on top of the allowlisted login-shell env. */
  env?: Record<string, string>;
  /** Served as the in-process `gravita` MCP server (`mcp__gravita__<name>`). */
  roleTools?: RoleTool[];
  toolGuard?: ToolGuard;
  /**
   * Without one, every permission prompt goes to the user (or, with `access`, the
   * runtime's answer for that access).
   */
  permissionPolicy?: PermissionPolicy;
}

/** How a turn ended (the SDK's result message), or that the session is over. */
export type TurnOutcome =
  | {
      kind: "result";
      /** "success", "error_max_turns", "error_max_budget_usd", "error_during_execution"… */
      subtype: string;
      isError: boolean;
      structuredOutput?: unknown;
      /** Cumulative for the session. */
      totalCostUsd?: number;
      numTurns?: number;
      errors: string[];
    }
  | {
      kind: "ended";
      /** `disposed`: someone disposed the runtime; `crashed`: the stream failed; `closed`: it just ended. */
      reason: "disposed" | "crashed" | "closed";
    };

/** A session's runtime. `start` begins consuming the agent's stream. */
export interface ChatRuntime extends SessionRuntime {
  start(): void;
  /**
   * The outcome of the next turn not yet handed out. Once the session is over it resolves
   * `ended`, for this and every later call.
   */
  nextTurn(): Promise<TurnOutcome>;
}

/** Creates the runtime of a new session on one provider (Claude Code: the Agent SDK). */
export interface ChatRuntimeFactory {
  create(spec: ChatRuntimeSpec): ChatRuntime;
}
