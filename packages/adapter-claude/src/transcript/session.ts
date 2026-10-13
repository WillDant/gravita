import { basename, join } from "node:path";
import type { GravitaEvent } from "@gravita/protocol";
import { nodeTranscriptFs, type TranscriptFs } from "./fs";
import { metaPathOf, SUBAGENT_FILE, subagentsDir } from "./subagents";
import { SessionTail } from "./tail";

export type { SubagentMeta } from "./subagents";

export interface SessionFiles {
  sessionId: string;
  mainPath: string;
  subagents: { agentId: string; jsonlPath: string; metaPath: string }[];
}

/** Locates the main transcript and its subagent files. Never reads anything else. */
export async function locateSession(
  mainPath: string,
  fs: TranscriptFs = nodeTranscriptFs,
): Promise<SessionFiles> {
  const sessionId = basename(mainPath, ".jsonl");
  const dir = subagentsDir(mainPath);
  const subagents: SessionFiles["subagents"] = [];
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
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

export interface ReadSessionOptions {
  projectId: string;
  fs?: TranscriptFs;
}

/**
 * Reads a whole session (main file + subagents) and returns its events, including
 * `agent.spawned` for each subagent with its parent resolved (see `resolveParent`).
 * It is one poll of a fresh `SessionTail` with no spawn grace, so the one-shot reader
 * and the incremental tail share a single assembly.
 */
export async function readSession(
  mainPath: string,
  opts: ReadSessionOptions,
): Promise<GravitaEvent[]> {
  // A missing main transcript is an error here, not an empty session still being written.
  await (opts.fs ?? nodeTranscriptFs).stat(mainPath);
  return new SessionTail(mainPath, { ...opts, spawnGraceMs: 0 }).poll();
}
