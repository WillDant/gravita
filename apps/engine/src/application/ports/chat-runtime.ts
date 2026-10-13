import type { PermissionMode, SessionKind } from "@gravita/protocol";
import type { ZodRawShape } from "zod";
import type { ClaudeEnvironment } from "./claude-environment";
import type { SessionRuntime } from "./session-runtime";

// The runtime of a Claude Code session Gravita starts: a chat, or a squad's planner or role
// session. Squad sessions add tools, a tool guard and limits; everything here is plain data
// and functions, and the infrastructure turns it into the Agent SDK's options.

/**
 * The modes a session can start in. `dontAsk` (deny whatever would prompt) is Gravita's
 * own: the planner uses it, the UI never offers it.
 */
export type RuntimePermissionMode = PermissionMode | "dontAsk";

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

/** A tool call about to run, as the PreToolUse hook sees it (subagents' calls included). */
export interface ToolCall {
  toolName: string;
  input: Record<string, unknown>;
  /** Set when a subagent makes the call. */
  agentId?: string;
  /** The agent's working directory at the time of the call. */
  cwd?: string;
}

/** A veto that runs before every tool call: a reason denies the call, undefined lets it through. */
export type ToolGuard = (call: ToolCall) => string | undefined;

export type PermissionVerdict = "allow" | "ask" | "deny";

/** Decides a permission prompt before it reaches the user: allow, deny, or ask them. */
export type PermissionPolicy = (
  toolName: string,
  input: Record<string, unknown>,
) => PermissionVerdict;

export interface ChatRuntimeSpec {
  sessionId: string;
  projectId: string;
  cwd: string;
  model?: string;
  permissionMode: RuntimePermissionMode;
  environment: ClaudeEnvironment;
  /** "chat" when absent. */
  kind?: SessionKind;
  /** Set on a squad's sessions. */
  squad?: { squadId: string; roleId?: string; taskId?: string };
  /** Appended to Claude Code's own system prompt (a role's charter). */
  systemPromptAppend?: string;
  /** Restricts the built-in tools to these. */
  tools?: string[];
  disallowedTools?: string[];
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
  /** Without one, every permission prompt goes to the user. */
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

/** Creates the runtime of a new session (Claude Code through the Agent SDK). */
export interface ChatRuntimeFactory {
  create(spec: ChatRuntimeSpec): ChatRuntime;
}
