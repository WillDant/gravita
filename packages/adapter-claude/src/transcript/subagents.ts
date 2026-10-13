import { basename, dirname, join } from "node:path";
import { type GravitaEvent, keys, MAIN_AGENT } from "@gravita/protocol";
import { isAgentTool } from "../tools";
import { nodeTranscriptFs, type TranscriptFs } from "./fs";
import type { RawRecord } from "./records";

// Subagent files and the spawn logic used by the tail state machine (tail-state.ts), which
// both the incremental tail and the one-shot reader (session.ts) run.

/** Undocumented `subagents/agent-<id>.meta.json`, read through an allowlist. */
export interface SubagentMeta {
  agentType?: string;
  description?: string;
  toolUseId?: string;
  spawnDepth?: number;
  parentAgentId?: string;
  requestShape?: string;
  model?: string;
  stoppedByUser?: boolean;
}

export const SUBAGENT_FILE = /^agent-(a[0-9a-f]{16})\.jsonl$/;

export function subagentsDir(mainPath: string): string {
  return join(dirname(mainPath), basename(mainPath, ".jsonl"), "subagents");
}

export function metaPathOf(jsonlPath: string): string {
  return jsonlPath.replace(/\.jsonl$/, ".meta.json");
}

export function parseMeta(raw: unknown): SubagentMeta {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const s = (k: string) => (typeof r[k] === "string" ? (r[k] as string) : undefined);
  const meta: SubagentMeta = {};
  const agentType = s("agentType");
  if (agentType) meta.agentType = agentType;
  const description = s("description");
  if (description) meta.description = description;
  const toolUseId = s("toolUseId");
  if (toolUseId) meta.toolUseId = toolUseId;
  const parentAgentId = s("parentAgentId");
  if (parentAgentId) meta.parentAgentId = parentAgentId;
  const requestShape = s("requestShape");
  if (requestShape) meta.requestShape = requestShape;
  const model = s("model");
  if (model) meta.model = model;
  if (typeof r.spawnDepth === "number") meta.spawnDepth = r.spawnDepth;
  if (r.stoppedByUser === true) meta.stoppedByUser = true;
  return meta;
}

/** Reads a meta file. `null` when it is missing or not (yet) valid JSON. */
export async function readMeta(
  path: string,
  fs: TranscriptFs = nodeTranscriptFs,
): Promise<SubagentMeta | null> {
  try {
    return parseMeta(JSON.parse(await fs.readText(path)));
  } catch {
    return null;
  }
}

/** Maps every Agent/Task tool_use id in `records` to `owner`, the agent that wrote them. */
export function indexAgentCalls(records: RawRecord[], owner: string, into: Map<string, string>) {
  for (const r of records) {
    const content = r.message?.content;
    if (r.type !== "assistant" || !Array.isArray(content)) continue;
    for (const b of content) {
      if (b.type === "tool_use" && b.id && b.name && isAgentTool(b.name)) into.set(b.id, owner);
    }
  }
}

/**
 * Parent of a subagent: meta.parentAgentId when present, otherwise the agent whose
 * Agent tool_use has meta.toolUseId, otherwise the main agent.
 */
export function resolveParent(meta: SubagentMeta, callOwner: ReadonlyMap<string, string>): string {
  return (
    meta.parentAgentId ?? (meta.toolUseId ? callOwner.get(meta.toolUseId) : undefined) ?? MAIN_AGENT
  );
}

/** True when `resolveParent` would not fall back to "main" for lack of data yet. */
export function parentKnown(meta: SubagentMeta, callOwner: ReadonlyMap<string, string>): boolean {
  return Boolean(meta.parentAgentId) || !meta.toolUseId || callOwner.has(meta.toolUseId);
}

export interface SpawnContext {
  projectId: string;
  sessionId: string;
  agentId: string;
}

const base = (ctx: SpawnContext, ts: string) => ({
  ts,
  source: "transcript" as const,
  provider: "claude" as const,
  projectId: ctx.projectId,
  sessionId: ctx.sessionId,
  agentId: ctx.agentId,
});

export function spawnedEvent(
  ctx: SpawnContext,
  meta: SubagentMeta,
  parent: string,
  ts: string,
): GravitaEvent {
  return {
    ...base(ctx, ts),
    key: keys.agentSpawned(ctx.sessionId, ctx.agentId),
    type: "agent.spawned",
    data: {
      parentAgentId: parent,
      ...(meta.toolUseId ? { spawnToolUseId: meta.toolUseId } : {}),
      agentType: meta.agentType ?? "general-purpose",
      ...(meta.description ? { description: meta.description } : {}),
      depth: meta.spawnDepth ?? 1,
      background: meta.requestShape === "background",
      ...(meta.model ? { model: meta.model } : {}),
    },
  };
}

/** The user stopped the subagent (only the meta file tells us). */
export function stoppedEvent(ctx: SpawnContext, ts: string): GravitaEvent {
  return {
    ...base(ctx, ts),
    key: keys.agentCompleted(ctx.sessionId, ctx.agentId),
    type: "agent.completed",
    data: { status: "stopped" },
  };
}
