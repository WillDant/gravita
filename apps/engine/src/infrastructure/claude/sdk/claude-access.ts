import { ASK_USER_QUESTION } from "@gravita/adapter-claude";
import type { PermissionVerdict, SessionAccess } from "../../../application/ports/chat-runtime";

// How a planning session's access becomes Claude Code options: the built-in tools it may
// use (an SDK option) and the answer to each permission prompt. Claude-specific: another
// provider restricts its sessions its own way (Codex: a read-only sandbox).

/** The planner reads the repository and nothing else. */
export const PLANNER_TOOLS: readonly string[] = ["Read", "Grep", "Glob"];

/** The briefing reads like the planner, and may also ask the user (that's its job). */
export const BRIEFING_TOOLS: readonly string[] = [...PLANNER_TOOLS, ASK_USER_QUESTION];

export const PLANNER_DISALLOWED_TOOLS: readonly string[] = [
  "Write",
  "Edit",
  "NotebookEdit",
  "Bash",
  "MultiEdit",
];

/** The planner reads the repository and nothing else; it never asks the user mid-plan. */
export function plannerPermission(toolName: string): PermissionVerdict {
  return PLANNER_TOOLS.includes(toolName) ? "allow" : "deny";
}

/**
 * The briefing session's answer to a permission prompt: reading is allowed, AskUserQuestion
 * goes to the user, anything else is denied. It runs in "default" mode rather than the
 * planner's "dontAsk", because "dontAsk" denies whatever isn't pre-approved without asking
 * Gravita, and AskUserQuestion only reaches the user through that question.
 */
export function briefingPermission(toolName: string): PermissionVerdict {
  if (toolName === ASK_USER_QUESTION) return "ask";
  return PLANNER_TOOLS.includes(toolName) ? "allow" : "deny";
}

export interface ClaudeAccess {
  tools: string[];
  disallowedTools: string[];
  permission(toolName: string): PermissionVerdict;
}

/** Claude Code's options for a session's access. */
export function claudeAccess(access: SessionAccess): ClaudeAccess {
  return access === "read-and-ask"
    ? {
        tools: [...BRIEFING_TOOLS],
        disallowedTools: [...PLANNER_DISALLOWED_TOOLS],
        permission: briefingPermission,
      }
    : {
        tools: [...PLANNER_TOOLS],
        disallowedTools: [...PLANNER_DISALLOWED_TOOLS],
        permission: plannerPermission,
      };
}
