import { basename, join } from "node:path";
import { type GravitaEvent, MAIN_AGENT } from "@gravita/protocol";
import type { TranscriptStat } from "./fs";
import { normalizeRecords } from "./normalize";
import { parseLine, parseLines, type RawRecord } from "./records";
import {
  indexAgentCalls,
  metaPathOf,
  parentKnown,
  resolveParent,
  SUBAGENT_FILE,
  type SubagentMeta,
  spawnedEvent,
  stoppedEvent,
  subagentsDir,
} from "./subagents";

/** Serializable progress of a tail, so a restarted engine resumes where it stopped. */
export interface TailCheckpoint {
  /** Per file ("main" or a subagent id): committed byte offset and inode. */
  files: Record<string, { offset: number; ino: number; firstTs?: string; lastTs?: string }>;
  /** Agent/Task tool_use id → agent that issued it (for parent resolution). */
  calls: Record<string, string>;
  /** Subagents whose `agent.spawned` was emitted. */
  spawned: string[];
  /** Subagents whose `agent.completed` was emitted (their meta no longer needs watching). */
  completed: string[];
  /** Whether `session.started` was emitted. */
  started: boolean;
}

export interface TailStateOptions {
  projectId: string;
  checkpoint?: TailCheckpoint;
  /** Clock for the spawn grace period. */
  now?: () => number;
  /**
   * How long a new subagent waits for its meta file, first record and parent's Agent call.
   * 0 spawns on the first poll (a one-shot read of a finished session).
   */
  spawnGraceMs?: number;
}

interface FileTrack {
  path: string;
  /** End of the last complete line consumed. `pending` holds the bytes after it. */
  offset: number;
  ino: number;
  pending: Buffer;
  mtimeMs: number;
  firstTs?: string;
  lastTs?: string;
}

interface SubTrack {
  meta: SubagentMeta | null;
  metaMtimeMs: number;
  seenAt: number;
  spawned: boolean;
}

const EMPTY = Buffer.alloc(0);

const asBuffer = (b: Uint8Array): Buffer =>
  Buffer.isBuffer(b) ? b : Buffer.from(b.buffer, b.byteOffset, b.byteLength);

/**
 * The pure state machine of a session tail: byte offsets and partial lines per file,
 * the spawn grace decision, and the normalize → spawned → stopped assembly shared by
 * the incremental tail and the one-shot `readSession`. It never touches the disk:
 * `SessionTail` feeds it what a `TranscriptFs` returned.
 */
export class SessionTailState {
  readonly sessionId: string;
  readonly mainPath: string;
  readonly subDir: string;
  private readonly projectId: string;
  private readonly now: () => number;
  private readonly graceMs: number;
  private readonly files = new Map<string, FileTrack>();
  private readonly subs = new Map<string, SubTrack>();
  private readonly calls = new Map<string, string>();
  private readonly completed = new Set<string>();
  private started = false;

  constructor(mainPath: string, opts: TailStateOptions) {
    this.mainPath = mainPath;
    this.sessionId = basename(mainPath, ".jsonl");
    this.projectId = opts.projectId;
    this.subDir = subagentsDir(mainPath);
    this.now = opts.now ?? Date.now;
    this.graceMs = opts.spawnGraceMs ?? 3_000;

    const cp = opts.checkpoint;
    this.files.set(MAIN_AGENT, track(mainPath, cp?.files[MAIN_AGENT]));
    if (!cp) return;
    this.started = cp.started;
    for (const [id, owner] of Object.entries(cp.calls)) this.calls.set(id, owner);
    for (const id of cp.completed) this.completed.add(id);
    const spawned = new Set(cp.spawned);
    for (const [agentId, f] of Object.entries(cp.files)) {
      if (agentId === MAIN_AGENT || !/^a[0-9a-f]{16}$/.test(agentId)) continue;
      this.files.set(agentId, track(join(this.subDir, `agent-${agentId}.jsonl`), f));
      this.subs.set(agentId, this.newSub(spawned.has(agentId)));
    }
  }

  /** Every tracked file as [agentId, path], main first. */
  fileEntries(): [string, string][] {
    return [...this.files].map(([id, t]) => [id, t.path]);
  }

  /** Starts tracking the subagent files among `names` (a listing of `subDir`). */
  addSubagents(names: readonly string[]) {
    for (const name of [...names].sort()) {
      const agentId = name.match(SUBAGENT_FILE)?.[1];
      if (!agentId || this.files.has(agentId)) continue;
      this.files.set(agentId, track(join(this.subDir, name)));
      this.subs.set(agentId, this.newSub(false));
    }
  }

  /**
   * Starts a read of a file whose current stat is `st`, and returns the byte position to
   * read from. A new, replaced (inode changed) or truncated file is read again from 0.
   */
  beginRead(agentId: string, st: TranscriptStat): number {
    const t = this.file(agentId);
    if (st.ino !== t.ino || st.size < t.offset + t.pending.length) {
      t.ino = st.ino;
      t.offset = 0;
      t.pending = EMPTY;
    }
    t.mtimeMs = st.mtimeMs;
    return t.offset + t.pending.length;
  }

  /** Consumes bytes read in order from `beginRead`'s position; complete lines go to `into`. */
  feed(agentId: string, chunk: Uint8Array, into: RawRecord[]) {
    const t = this.file(agentId);
    const bytes = asBuffer(chunk);
    const data = t.pending.length ? Buffer.concat([t.pending, bytes]) : bytes;
    const nl = data.lastIndexOf(0x0a);
    if (nl < 0) {
      t.pending = Buffer.from(data);
      return;
    }
    for (const r of parseLines(data.subarray(0, nl).toString("utf8"))) into.push(r);
    t.offset += nl + 1;
    t.pending = Buffer.from(data.subarray(nl + 1));
  }

  /** Finishes a read: accepts a complete trailing line and records first/last timestamps. */
  endRead(agentId: string, records: RawRecord[]) {
    const t = this.file(agentId);
    // A strict prefix of a JSON object never parses, so a pending line that parses is
    // a complete record still waiting for its newline.
    if (t.pending.length) {
      const r = parseLine(t.pending.toString("utf8"));
      if (r) {
        records.push(r);
        t.offset += t.pending.length;
        t.pending = EMPTY;
      }
    }
    for (const r of records) {
      if (!r.timestamp) continue;
      t.firstTs ??= r.timestamp;
      t.lastTs = r.timestamp;
    }
  }

  /** Subagents whose meta file still matters, with the mtime of the meta last accepted. */
  metaWatch(): { agentId: string; metaPath: string; mtimeMs: number }[] {
    const out: { agentId: string; metaPath: string; mtimeMs: number }[] = [];
    for (const agentId of [...this.subs.keys()].sort()) {
      const sub = this.subs.get(agentId)!;
      if (sub.spawned && this.completed.has(agentId)) continue;
      out.push({
        agentId,
        metaPath: metaPathOf(this.file(agentId).path),
        mtimeMs: sub.metaMtimeMs,
      });
    }
    return out;
  }

  setMeta(agentId: string, meta: SubagentMeta, mtimeMs: number) {
    const sub = this.subs.get(agentId);
    if (!sub) return;
    sub.meta = meta;
    sub.metaMtimeMs = mtimeMs;
  }

  /** Turns the records read in one poll (per agent) into events, in a stable order. */
  assemble(read: ReadonlyMap<string, RawRecord[]>): GravitaEvent[] {
    // Index every file before resolving spawns, so a parent's Agent call written in the
    // same poll as its child's first line is already known.
    for (const [agentId, recs] of read) indexAgentCalls(recs, agentId, this.calls);

    const out = this.normalize(MAIN_AGENT, read.get(MAIN_AGENT));
    for (const agentId of [...this.subs.keys()].sort()) {
      const own = this.normalize(agentId, read.get(agentId));
      out.push(...this.lifecycleEvents(agentId), ...own);
    }
    for (const e of out)
      if (e.type === "agent.completed" && e.agentId) this.completed.add(e.agentId);
    return out;
  }

  checkpoint(): TailCheckpoint {
    const files: TailCheckpoint["files"] = {};
    for (const [id, t] of this.files) {
      files[id] = {
        offset: t.offset,
        ino: t.ino,
        ...(t.firstTs ? { firstTs: t.firstTs } : {}),
        ...(t.lastTs ? { lastTs: t.lastTs } : {}),
      };
    }
    return {
      files,
      calls: Object.fromEntries(this.calls),
      spawned: [...this.subs].filter(([, s]) => s.spawned).map(([id]) => id),
      completed: [...this.completed],
      started: this.started,
    };
  }

  private newSub(spawned: boolean): SubTrack {
    return { meta: null, metaMtimeMs: -1, seenAt: this.now(), spawned };
  }

  private file(agentId: string): FileTrack {
    const t = this.files.get(agentId);
    if (!t) throw new Error(`untracked transcript file: ${agentId}`);
    return t;
  }

  private normalize(agentId: string, recs: RawRecord[] | undefined): GravitaEvent[] {
    const t = this.files.get(agentId);
    if (!recs?.length || !t) return [];
    const events = normalizeRecords(recs, {
      projectId: this.projectId,
      sessionId: this.sessionId,
      agentId,
      filePath: t.path,
    });
    if (agentId !== MAIN_AGENT) return events;
    // normalizeRecords emits session.started once per call; keep only the first ever.
    return events.filter((e) => {
      if (e.type !== "session.started") return true;
      if (this.started) return false;
      this.started = true;
      return true;
    });
  }

  /** `agent.spawned` once the meta file, first record and parent are known (or grace ran out). */
  private lifecycleEvents(agentId: string): GravitaEvent[] {
    const sub = this.subs.get(agentId);
    const file = this.files.get(agentId);
    if (!sub || !file || (sub.spawned && this.completed.has(agentId))) return [];

    const ctx = { projectId: this.projectId, sessionId: this.sessionId, agentId };
    const out: GravitaEvent[] = [];
    if (!sub.spawned) {
      const expired = this.now() - sub.seenAt >= this.graceMs;
      const ready =
        sub.meta !== null && file.firstTs !== undefined && parentKnown(sub.meta, this.calls);
      if (!ready && !expired) return [];
      const meta = sub.meta ?? {};
      const ts = file.firstTs ?? new Date(file.mtimeMs).toISOString();
      out.push(spawnedEvent(ctx, meta, resolveParent(meta, this.calls), ts));
      sub.spawned = true;
    }
    if (sub.meta?.stoppedByUser && !this.completed.has(agentId)) {
      out.push(stoppedEvent(ctx, file.lastTs ?? ""));
    }
    return out;
  }
}

function track(path: string, cp?: TailCheckpoint["files"][string]): FileTrack {
  return {
    path,
    offset: cp?.offset ?? 0,
    ino: cp?.ino ?? -1,
    pending: EMPTY,
    mtimeMs: 0,
    ...(cp?.firstTs ? { firstTs: cp.firstTs } : {}),
    ...(cp?.lastTs ? { lastTs: cp.lastTs } : {}),
  };
}
