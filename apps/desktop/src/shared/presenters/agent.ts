import type { AgentNode, Line } from "@gravita/core";
import { MAIN_AGENT } from "@gravita/protocol/ids";
import { t } from "@/shared/i18n/i18n";
import { basename } from "@/shared/utils";

/** "Main agent" for the session's main agent, else its subagent type (Explore, Plan…). */
export function agentName(
  node: Pick<AgentNode, "id" | "agentType"> | Pick<Line, "agentId" | "agentType">,
): string {
  const id = "id" in node ? node.id : node.agentId;
  return id === MAIN_AGENT ? t("agent.main") : node.agentType;
}

/** What a waiting agent asks for, in one line: "Bash · pnpm add jose". */
export function permissionSummary(agent: AgentNode): string | undefined {
  const req = Object.values(agent.permissions ?? {})[0];
  return req ? `${req.toolName} · ${req.inputPreview}` : undefined;
}

/** The last tool's target in a few characters: a file name, a command, a query or a URL. */
export function toolShort(tool: NonNullable<AgentNode["lastTool"]>): string {
  const target = tool.target;
  return target.path
    ? basename(target.path)
    : (target.cmd ?? target.query ?? target.url ?? tool.inputPreview);
}
