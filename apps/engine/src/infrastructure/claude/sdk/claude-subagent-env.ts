import type { SquadModels } from "@gravita/protocol";
import {
  ROLE_SUBAGENT_LIMITS,
  type SubagentPolicy,
  squadSubagents,
} from "../../../domain/squad-policy";

// How Claude Code reads a subagent policy: environment variables of the session.

/**
 * The environment that carries a subagent policy. Claude Code reads
 * CLAUDE_CODE_SUBAGENT_MODEL for any subagent whose definition doesn't name a model (an
 * explicit model on the Agent call or in an agent's definition still wins, and Explore
 * already runs on Haiku by default), and bounds the fan-out with the other two.
 */
export function claudeSubagentEnv(p: SubagentPolicy | undefined): Record<string, string> {
  if (!p) return {};
  return {
    ...(p.maxConcurrent !== undefined
      ? { CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: String(p.maxConcurrent) }
      : {}),
    ...(p.maxDepth !== undefined
      ? { CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: String(p.maxDepth) }
      : {}),
    ...(p.model ? { CLAUDE_CODE_SUBAGENT_MODEL: p.model } : {}),
  };
}

/** The environment of every squad session: Haiku subagents under Automatic, else nothing. */
export function squadEnv(models: SquadModels): Record<string, string> {
  return claudeSubagentEnv(squadSubagents(models));
}

/** What role sessions add: bounded fan-out. */
export const ROLE_ENV: Readonly<Record<string, string>> = claudeSubagentEnv(ROLE_SUBAGENT_LIMITS);
