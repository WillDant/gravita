import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { type GravitaEvent, MAIN_AGENT } from "@gravita/protocol";
import { normalizeRecords } from "./normalize";
import { parseLines, type RawRecord } from "./records";
import {
  indexAgentCalls,
  metaPathOf,
  readMeta,
  resolveParent,
  SUBAGENT_FILE,
  type SubagentMeta,
  spawnedEvent,
  stoppedEvent,
  subagentsDir,
} from "./subagents";

export type { SubagentMeta } from "./subagents";

export interface SessionFiles {
  sessionId: string;
  mainPath: string;
  subagents: { agentId: string; jsonlPath: string; metaPath: string }[];
}

/** Locates the main transcript and its subagent files. Never reads anything else. */
export async function locateSession(mainPath: string): Promise<SessionFiles> {
  const sessionId = basename(mainPath, ".jsonl");
  const dir = subagentsDir(mainPath);
  const subagents: SessionFiles["subagents"] = [];
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    // No subagents folder: a session that never delegated.
  }
  for (const name of entries) {
    const m = name.match(SUBAGENT_FILE);
    if (!m) continue;
    const jsonlPath = join(dir, name);
    subagents.push({ agentId: m[1]!, jsonlPath, metaPath: metaPathOf(jsonlPath) });
  }
  subagents.sort((a, b) => a.agentId.localeCompare(b.agentId));
  return { sessionId, mainPath, subagents };
}

function firstTimestamp(records: RawRecord[]): string {
  return records.find((r) => r.timestamp)?.timestamp ?? "";
}

export interface ReadSessionOptions {
  projectId: string;
}

/**
 * Reads a whole session (main file + subagents) and returns its events, including
 * `agent.spawned` for each subagent with its parent resolved (see `resolveParent`).
 */
export async function readSession(
  mainPath: string,
  opts: ReadSessionOptions,
): Promise<GravitaEvent[]> {
  const files = await locateSession(mainPath);
  const mainRecords = parseLines(await readFile(files.mainPath, "utf8"));
  const subRecords = new Map<string, RawRecord[]>();
  const metas = new Map<string, SubagentMeta>();
  for (const s of files.subagents) {
    subRecords.set(s.agentId, parseLines(await readFile(s.jsonlPath, "utf8")));
    metas.set(s.agentId, (await readMeta(s.metaPath)) ?? {});
  }

  const callOwner = new Map<string, string>();
  indexAgentCalls(mainRecords, MAIN_AGENT, callOwner);
  for (const [agentId, recs] of subRecords) indexAgentCalls(recs, agentId, callOwner);

  const events: GravitaEvent[] = normalizeRecords(mainRecords, {
    projectId: opts.projectId,
    sessionId: files.sessionId,
    agentId: MAIN_AGENT,
    filePath: files.mainPath,
  });

  for (const s of files.subagents) {
    const meta = metas.get(s.agentId) ?? {};
    const recs = subRecords.get(s.agentId) ?? [];
    const ctx = { projectId: opts.projectId, sessionId: files.sessionId, agentId: s.agentId };
    events.push(spawnedEvent(ctx, meta, resolveParent(meta, callOwner), firstTimestamp(recs)));
    if (meta.stoppedByUser) events.push(stoppedEvent(ctx, recs.at(-1)?.timestamp ?? ""));
    events.push(...normalizeRecords(recs, { ...ctx, filePath: s.jsonlPath }));
  }
  return events;
}
