import type { AgentNode, Line } from "@gravita/core";
import { MAIN_AGENT } from "@gravita/protocol/ids";
import { t } from "@/shared/i18n/i18n";
import { basename } from "@/shared/utils";

/** "Main agent" for the session's main agent, else its subagent type (Explore, Plan…). */
export function agentName(
  node: Pick<AgentNode, "id" | "agentType"> | Pick<Line, "agentId" | "agentType">,
): string {
  const id = "id" in node ? node.id : node.agentId;
  return id === MAIN_AGENT ? t("agent.main") : agentTypeLabel(node.agentType);
}

/**
 * Codex names its subagent roles in lowercase words ("explorer", "default"); they read as
 * names in the user's language. Claude Code's types (Explore, general-purpose, a custom
 * agent's name) are already what the user wrote, so they show as they are.
 */
const ROLE_LABELS: Readonly<Record<string, string>> = {
  explorer: "agent.role.explorer",
  worker: "agent.role.worker",
  default: "agent.role.default",
};

/** A subagent type as the user reads it: a translated Codex role, else the type itself. */
export function agentTypeLabel(agentType: string): string {
  const key = ROLE_LABELS[agentType];
  return key ? t(key) : agentType;
}

/** Codex and Cursor prefix their session and agent ids for routing; people never need it. */
const PROVIDER_ID_PREFIX = /^(codex|cursor):/;

/** A session or agent id as text on screen, without the provider prefix kept for routing. */
export function displayId(id: string): string {
  return id.replace(PROVIDER_ID_PREFIX, "");
}

/** What a waiting agent asks for, in one line: "Bash · pnpm add jose". */
export function permissionSummary(agent: AgentNode): string | undefined {
  const req = Object.values(agent.permissions ?? {})[0];
  return req ? `${req.toolName} · ${req.inputPreview}` : undefined;
}

/**
 * What a waiting agent wants from the user, in one line: its oldest open question, else
 * its permission request ("Bash · pnpm add jose"). Same line as Home's "Needs you" row.
 */
export function pendingAsk(agent: AgentNode): string | undefined {
  const question = Object.values(agent.questions ?? {}).sort((a, b) => a.ts.localeCompare(b.ts))[0];
  return question?.questions[0]?.question ?? permissionSummary(agent);
}

/** The last tool's target in a few characters: a file name, a command, a query or a URL. */
export function toolShort(tool: NonNullable<AgentNode["lastTool"]>): string {
  const target = tool.target;
  return target.path
    ? basename(target.path)
    : (target.cmd ?? target.query ?? target.url ?? tool.inputPreview);
}
