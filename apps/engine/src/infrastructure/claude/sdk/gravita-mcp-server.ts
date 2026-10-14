import {
  createSdkMcpServer,
  type HookCallbackMatcher,
  type HookJSONOutput,
  type McpSdkServerConfigWithInstance,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import { claudeToolCall, EDIT_TOOLS } from "@gravita/adapter-claude";
import type { RoleTool, ToolGuard, ToolReply } from "../../../application/ports/chat-runtime";

// The SDK side of a squad session's extras: role tools become an in-process MCP server and
// the tool guard becomes a PreToolUse hook. Both are thin; the behaviour lives in the
// application (plain handlers and a pure policy).

/** The server name; the model sees its tools as `mcp__gravita__<tool>`. */
export const GRAVITA_MCP_SERVER = "gravita";

/** The MCP result of a role tool's reply. */
export function toCallToolResult(reply: ToolReply) {
  return {
    content: [{ type: "text" as const, text: reply.text }],
    ...(reply.isError ? { isError: true } : {}),
  };
}

/** Runs a handler and turns a throw into an error result, so a bug never kills the turn. */
async function callSafely(t: RoleTool, args: Record<string, unknown>) {
  try {
    return toCallToolResult(await t.handler(args));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return toCallToolResult({ text: `Gravita couldn't run ${t.name}: ${message}`, isError: true });
  }
}

export function buildGravitaMcpServer(
  tools: readonly RoleTool[],
  version: string,
): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: GRAVITA_MCP_SERVER,
    version,
    // Few tools, used on every task: never hide them behind tool search.
    alwaysLoad: true,
    tools: tools.map((t) =>
      tool(t.name, t.description, t.input, (args) =>
        callSafely(t, (args ?? {}) as Record<string, unknown>),
      ),
    ),
  });
}

/**
 * Claude Code's tools whose calls the guard judges (the ones that edit files, and Bash).
 * Everything else passes the hook untouched.
 */
export const GUARDED_TOOLS = [...EDIT_TOOLS, "Bash"].join("|");

/**
 * The guard as a PreToolUse hook. Hooks run before the permission callback and a deny
 * wins in every permission mode; they also fire for subagents' tool calls.
 */
export function guardHooks(
  guard: ToolGuard,
  onDeny: (toolName: string, reason: string, agentId?: string) => void,
): HookCallbackMatcher[] {
  return [
    {
      matcher: GUARDED_TOOLS,
      hooks: [
        async (input): Promise<HookJSONOutput> => {
          if (input.hook_event_name !== "PreToolUse") return { continue: true };
          const toolInput =
            input.tool_input && typeof input.tool_input === "object"
              ? (input.tool_input as Record<string, unknown>)
              : {};
          const reason = guard(
            claudeToolCall(input.tool_name, toolInput, {
              ...(input.agent_id ? { agentId: input.agent_id } : {}),
              ...(input.cwd ? { cwd: input.cwd } : {}),
            }),
          );
          if (reason === undefined) return { continue: true };
          onDeny(input.tool_name, reason, input.agent_id);
          return {
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason: reason,
            },
          };
        },
      ],
    },
  ];
}
