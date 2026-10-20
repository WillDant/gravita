import type { SDKControlGetContextUsageResponse } from "@anthropic-ai/claude-agent-sdk";
import type { ContextUsage } from "@gravita/protocol";

/**
 * The Agent SDK's /context breakdown in Gravita's protocol terms. Fields the SDK only sends
 * from newer CLIs stay optional; the grid and colour names (the CLI's own rendering) are left
 * out.
 */
export function toContextUsage(r: SDKControlGetContextUsageResponse): ContextUsage {
  const m = r.messageBreakdown;
  return {
    model: r.model,
    totalTokens: r.totalTokens,
    maxTokens: r.rawMaxTokens || r.maxTokens,
    percentage: r.percentage,
    categories: r.categories.map((c) => ({
      name: c.name,
      tokens: c.tokens,
      // Older CLIs only flag deferred rows; their other rows are in use.
      kind: c.kind ?? (c.isDeferred ? "deferred" : "used"),
    })),
    memoryFiles: r.memoryFiles.map((f) => ({ path: f.path, type: f.type, tokens: f.tokens })),
    mcpTools: r.mcpTools.map((t) => ({
      name: t.name,
      serverName: t.serverName,
      tokens: t.tokens,
      ...(t.isLoaded === undefined ? {} : { loaded: t.isLoaded }),
    })),
    agents: r.agents.map((a) => ({ agentType: a.agentType, source: a.source, tokens: a.tokens })),
    ...(r.skills
      ? {
          skills: {
            total: r.skills.totalSkills,
            included: r.skills.includedSkills,
            tokens: r.skills.tokens,
            items: r.skills.skillFrontmatter.map((s) => ({
              name: s.name,
              source: s.source,
              tokens: s.tokens,
            })),
          },
        }
      : {}),
    ...(r.systemTools
      ? { systemTools: r.systemTools.map((t) => ({ name: t.name, tokens: t.tokens })) }
      : {}),
    ...(m
      ? {
          messages: {
            toolCalls: m.toolCallTokens,
            toolResults: m.toolResultTokens,
            attachments: m.attachmentTokens,
            assistant: m.assistantMessageTokens,
            user: m.userMessageTokens,
          },
        }
      : {}),
    ...(r.isAutoCompactEnabled && r.autoCompactThreshold !== undefined
      ? { autoCompactThreshold: r.autoCompactThreshold }
      : {}),
    autoCompact: r.isAutoCompactEnabled,
  };
}
