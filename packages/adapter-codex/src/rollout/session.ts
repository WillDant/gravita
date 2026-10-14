import type { GravitaEvent } from "@gravita/protocol";
import { nodeRolloutFs, type RolloutFs } from "./fs";
import { CodexSessionTail, type ThreadFile } from "./tail";

/** A Gravita session in Codex terms: a root thread and the subagent threads under it. */
export interface CodexSessionFiles {
  root: ThreadFile;
  /** Every subagent below the root, at any depth, oldest first. */
  subagents: ThreadFile[];
}

/**
 * The top thread above `threadId`, following parent ids through the known threads (Codex
 * also records it as `session_id`). Undefined when the chain leaves the known threads.
 */
function rootOf(
  meta: ThreadFile["meta"],
  byId: ReadonlyMap<string, ThreadFile>,
): string | undefined {
  if (meta.role === "root") return meta.threadId;
  if (meta.rootThreadId && byId.get(meta.rootThreadId)?.meta.role === "root")
    return meta.rootThreadId;
  const seen = new Set<string>();
  let cur: ThreadFile["meta"] | undefined = meta;
  while (cur && cur.role === "subagent" && cur.parentThreadId && !seen.has(cur.threadId)) {
    seen.add(cur.threadId);
    cur = byId.get(cur.parentThreadId)?.meta;
  }
  return cur?.role === "root" ? cur.threadId : undefined;
}

/**
 * Groups rollouts into sessions: each root thread with every subagent spawned below it.
 * Internal threads (the guardian reviewer and other helpers Codex runs for itself) and
 * subagents whose root rollout isn't among `files` (archived, or not written yet) are left out.
 */
export function groupThreads(files: readonly ThreadFile[]): CodexSessionFiles[] {
  const byId = new Map<string, ThreadFile>();
  for (const f of files) {
    const known = byId.get(f.meta.threadId);
    // A thread written both plain and compressed: read the plain one, it may still grow.
    if (!known || known.path.endsWith(".zst")) byId.set(f.meta.threadId, f);
  }
  const sessions = new Map<string, CodexSessionFiles>();
  for (const f of byId.values()) {
    if (f.meta.role === "root") sessions.set(f.meta.threadId, { root: f, subagents: [] });
  }
  for (const f of byId.values()) {
    if (f.meta.role !== "subagent") continue;
    const root = rootOf(f.meta, byId);
    if (root) sessions.get(root)?.subagents.push(f);
  }
  for (const s of sessions.values()) {
    s.subagents.sort(
      (a, b) =>
        (a.meta.ts ?? "").localeCompare(b.meta.ts ?? "") ||
        a.meta.threadId.localeCompare(b.meta.threadId),
    );
  }
  return [...sessions.values()];
}

export interface ReadCodexSessionOptions {
  projectId: string;
  fs?: RolloutFs;
}

/**
 * Reads a whole session (root rollout + subagents) and returns its events. It is one poll
 * of a fresh `CodexSessionTail` with no spawn grace, so the one-shot reader and the
 * incremental tail share a single assembly.
 */
export async function readCodexSession(
  session: CodexSessionFiles,
  opts: ReadCodexSessionOptions,
): Promise<GravitaEvent[]> {
  // A missing root rollout is an error here, not a session still being written.
  await (opts.fs ?? nodeRolloutFs).stat(session.root.path);
  const tail = new CodexSessionTail(session.root, { ...opts, spawnGraceMs: 0 });
  tail.addThreads(session.subagents);
  return tail.poll();
}
