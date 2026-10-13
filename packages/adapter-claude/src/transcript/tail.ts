import { open, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { type GravitaEvent, MAIN_AGENT } from "@gravita/protocol";
import { normalizeRecords } from "./normalize";
import { parseLine, parseLines, type RawRecord } from "./records";
import {
  indexAgentCalls,
  metaPathOf,
  parentKnown,
  readMeta,
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

export interface SessionTailOptions {
  projectId: string;
  checkpoint?: TailCheckpoint;
  /** Clock for the spawn grace period. */
  now?: () => number;
  /** How long a new subagent waits for its meta file, first record and parent's Agent call. */
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

const READ_CHUNK = 4 * 1024 * 1024;
const EMPTY = Buffer.alloc(0);

/**
 * Incremental reader of one session (main transcript + `subagents/`). Each `poll()`
 * reads only appended bytes, keeps partial trailing lines for the next poll, and
 * rescans a file from 0 when it was replaced or truncated (idempotency keys make
 * re-emitted events harmless). Polls are serialized.
 */
export class SessionTail {
  readonly sessionId: string;
  readonly mainPath: string;
  private readonly projectId: string;
  private readonly subDir: string;
  private readonly now: () => number;
  private readonly graceMs: number;
  private readonly files = new Map<string, FileTrack>();
  private readonly subs = new Map<string, SubTrack>();
  private readonly calls = new Map<string, string>();
  private readonly completed = new Set<string>();
  private started = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(mainPath: string, opts: SessionTailOptions) {
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
      this.subs.set(agentId, {
        meta: null,
        metaMtimeMs: -1,
        seenAt: this.now(),
        spawned: spawned.has(agentId),
      });
    }
  }

  /** Reads whatever was appended since the last poll and returns the new events. */
  poll(): Promise<GravitaEvent[]> {
    const run = this.queue.then(() => this.step());
    this.queue = run.catch(() => undefined);
    return run;
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

  private async step(): Promise<GravitaEvent[]> {
    await this.discoverSubagents();
    const read = new Map<string, RawRecord[]>();
    // Read every file before resolving spawns, so a parent's Agent call written in the
    // same poll as its child's first line is already indexed.
    for (const [agentId, t] of this.files) {
      const recs = await readAppended(t);
      if (!recs.length) continue;
      indexAgentCalls(recs, agentId, this.calls);
      read.set(agentId, recs);
    }

    const out = this.normalize(MAIN_AGENT, read.get(MAIN_AGENT));
    for (const agentId of [...this.subs.keys()].sort()) {
      const own = this.normalize(agentId, read.get(agentId));
      out.push(...(await this.lifecycleEvents(agentId)), ...own);
    }
    for (const e of out)
      if (e.type === "agent.completed" && e.agentId) this.completed.add(e.agentId);
    return out;
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

  private async discoverSubagents() {
    try {
      const names = await readdir(this.subDir);
      for (const name of names.sort()) {
        const agentId = name.match(SUBAGENT_FILE)?.[1];
        if (!agentId || this.files.has(agentId)) continue;
        this.files.set(agentId, track(join(this.subDir, name)));
        this.subs.set(agentId, { meta: null, metaMtimeMs: -1, seenAt: this.now(), spawned: false });
      }
    } catch {
      // No subagents folder yet.
    }
  }

  /** `agent.spawned` once the meta file, first record and parent are known (or grace ran out). */
  private async lifecycleEvents(agentId: string): Promise<GravitaEvent[]> {
    const sub = this.subs.get(agentId);
    const file = this.files.get(agentId);
    if (!sub || !file || (sub.spawned && this.completed.has(agentId))) return [];

    const metaPath = metaPathOf(file.path);
    try {
      const mtimeMs = (await stat(metaPath)).mtimeMs;
      if (mtimeMs !== sub.metaMtimeMs) {
        const meta = await readMeta(metaPath);
        if (meta) {
          sub.meta = meta;
          sub.metaMtimeMs = mtimeMs;
        }
      }
    } catch {
      // Meta not written yet.
    }

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

async function readAppended(t: FileTrack): Promise<RawRecord[]> {
  let st: Awaited<ReturnType<typeof stat>>;
  try {
    st = await stat(t.path);
  } catch {
    return [];
  }
  if (st.ino !== t.ino || st.size < t.offset + t.pending.length) {
    // New file, replaced (inode changed) or truncated: read it again from the start.
    t.ino = st.ino;
    t.offset = 0;
    t.pending = EMPTY;
  }
  t.mtimeMs = st.mtimeMs;

  const records: RawRecord[] = [];
  let pos = t.offset + t.pending.length;
  if (pos < st.size) {
    const fh = await open(t.path, "r");
    try {
      while (pos < st.size) {
        const len = Math.min(READ_CHUNK, st.size - pos);
        const buf = Buffer.allocUnsafe(len);
        const { bytesRead } = await fh.read(buf, 0, len, pos);
        if (bytesRead <= 0) break;
        pos += bytesRead;
        consume(t, buf.subarray(0, bytesRead), records);
      }
    } finally {
      await fh.close();
    }
  }
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
  return records;
}

function consume(t: FileTrack, chunk: Buffer, into: RawRecord[]) {
  const data = t.pending.length ? Buffer.concat([t.pending, chunk]) : chunk;
  const nl = data.lastIndexOf(0x0a);
  if (nl < 0) {
    t.pending = Buffer.from(data);
    return;
  }
  for (const r of parseLines(data.subarray(0, nl).toString("utf8"))) into.push(r);
  t.offset += nl + 1;
  t.pending = Buffer.from(data.subarray(nl + 1));
}

export interface SessionHead {
  cwd: string;
  /** Timestamp of the first timestamped record. */
  ts: string;
}

/** Reads the start of a transcript until a record carries `cwd`. `null` if none yet. */
export async function readSessionHead(
  path: string,
  maxBytes = 1 << 20,
): Promise<SessionHead | null> {
  let fh: Awaited<ReturnType<typeof open>>;
  try {
    fh = await open(path, "r");
  } catch {
    return null;
  }
  try {
    const decoder = new StringDecoder("utf8");
    const buf = Buffer.allocUnsafe(64 * 1024);
    let pending = "";
    let ts: string | undefined;
    let pos = 0;
    while (pos < maxBytes) {
      const { bytesRead } = await fh.read(buf, 0, buf.length, pos);
      if (bytesRead <= 0) break;
      pos += bytesRead;
      const lines = (pending + decoder.write(buf.subarray(0, bytesRead))).split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const r = parseLine(line);
        if (!r) continue;
        ts ??= r.timestamp;
        if (r.cwd) return { cwd: r.cwd, ts: r.timestamp ?? ts ?? "" };
      }
    }
    const last = parseLine(pending);
    if (last?.cwd) return { cwd: last.cwd, ts: last.timestamp ?? ts ?? "" };
    return null;
  } finally {
    await fh.close();
  }
}
