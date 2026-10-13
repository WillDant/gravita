import { type GravitaEvent, keys, MAIN_AGENT } from "@gravita/protocol";
import { codexAgentId, codexSessionId } from "../ids";
import type { RolloutStat } from "./fs";
import { newThreadState, RolloutNormalizer, type ThreadState } from "./normalize";
import { parseRolloutLine, parseRolloutLines, type RolloutLine, type SessionMeta } from "./records";

/** One rollout of a session: the root thread's, or a subagent's. */
export interface ThreadFile {
  path: string;
  meta: SessionMeta;
}

/** Serializable progress of a session tail, so a restarted engine resumes where it stopped. */
export interface CodexTailCheckpoint {
  /** Per thread id: its rollout, committed byte offset, inode and mapper state. */
  threads: Record<
    string,
    { path: string; offset: number; ino: number; lastTs?: string; state: ThreadState }
  >;
  /** Subagent threads whose `agent.spawned` was emitted. */
  spawned: string[];
}

export interface CodexTailStateOptions {
  projectId: string;
  checkpoint?: CodexTailCheckpoint;
  /** Clock for the spawn grace period. */
  now?: () => number;
  /**
   * How long a new subagent waits for its parent's spawn_agent output (which links the
   * call to the child). 0 spawns on the first poll (a one-shot read of a finished session).
   */
  spawnGraceMs?: number;
}

interface Track {
  threadId: string;
  path: string;
  meta?: SessionMeta;
  /** End of the last complete line consumed (in decompressed bytes for `.zst`). */
  offset: number;
  ino: number;
  pending: Buffer;
  /** Compressed size last read, for `.zst` rollouts. */
  zsize?: number;
  mtimeMs: number;
  lastTs?: string;
  normalizer: RolloutNormalizer;
  /** Subagents: when the tail first saw it, and whether `agent.spawned` was emitted. */
  seenAt: number;
  spawned: boolean;
}

const EMPTY = Buffer.alloc(0);

const asBuffer = (b: Uint8Array): Buffer =>
  Buffer.isBuffer(b) ? b : Buffer.from(b.buffer, b.byteOffset, b.byteLength);

/**
 * The pure state machine of one Codex session: the root thread's rollout plus its
 * subagents' rollouts (each a file of its own, linked by parent thread id). It keeps byte
 * offsets and partial lines per file, a mapper per thread, and decides when a subagent's
 * `agent.spawned` can be emitted. It never touches the disk: `CodexSessionTail` feeds it.
 */
export class CodexTailState {
  readonly sessionId: string;
  readonly rootThreadId: string;
  private readonly projectId: string;
  private readonly now: () => number;
  private readonly graceMs: number;
  private readonly threads = new Map<string, Track>();

  constructor(root: ThreadFile, opts: CodexTailStateOptions) {
    this.rootThreadId = root.meta.threadId;
    this.sessionId = codexSessionId(this.rootThreadId);
    this.projectId = opts.projectId;
    this.now = opts.now ?? Date.now;
    this.graceMs = opts.spawnGraceMs ?? 3_000;
    const cp = opts.checkpoint;
    const spawned = new Set(cp?.spawned ?? []);
    if (cp) {
      for (const [threadId, t] of Object.entries(cp.threads)) {
        if (threadId === this.rootThreadId && t.path !== root.path) continue;
        this.track(threadId, t.path, undefined, t, spawned.has(threadId));
      }
    }
    const rootTrack = this.threads.get(this.rootThreadId);
    if (rootTrack) rootTrack.meta = root.meta;
    else this.track(this.rootThreadId, root.path, root.meta);
  }

  /** Starts tracking (or refreshes the meta of) the session's subagent rollouts. */
  addThreads(files: readonly ThreadFile[]) {
    for (const f of files) {
      const id = f.meta.threadId;
      if (id === this.rootThreadId || f.meta.role !== "subagent") continue;
      const known = this.threads.get(id);
      if (known) {
        known.meta ??= f.meta;
        continue;
      }
      this.track(id, f.path, f.meta);
    }
  }

  /** Every tracked rollout as [threadId, path], root first. */
  fileEntries(): [string, string][] {
    return [...this.threads.values()].map((t) => [t.threadId, t.path]);
  }

  /** True while any thread of the session has a turn in progress. */
  openTurn(): boolean {
    for (const t of this.threads.values()) if (t.normalizer.state.openTurn) return true;
    return false;
  }

  /**
   * Starts a read of a rollout whose current stat is `st`; returns the byte position to read
   * from. A replaced (inode changed) or truncated file is read again from 0.
   */
  beginRead(threadId: string, st: RolloutStat): number {
    const t = this.get(threadId);
    if (st.ino !== t.ino || st.size < t.offset + t.pending.length) this.reset(t, st.ino);
    t.mtimeMs = st.mtimeMs;
    return t.offset + t.pending.length;
  }

  /**
   * A compressed rollout is decompressed whole: returns the position in `data` to continue
   * from, or -1 when its compressed size hasn't changed since the last read.
   */
  beginCompressedRead(threadId: string, st: RolloutStat, dataLength?: number): number {
    const t = this.get(threadId);
    if (dataLength === undefined) return st.ino === t.ino && st.size === t.zsize ? -1 : 0;
    if (st.ino !== t.ino || dataLength < t.offset + t.pending.length) this.reset(t, st.ino);
    t.zsize = st.size;
    t.mtimeMs = st.mtimeMs;
    return t.offset + t.pending.length;
  }

  /** Consumes bytes read in order from `beginRead`'s position; complete lines go to `into`. */
  feed(threadId: string, chunk: Uint8Array, into: RolloutLine[]) {
    const t = this.get(threadId);
    const bytes = asBuffer(chunk);
    const data = t.pending.length ? Buffer.concat([t.pending, bytes]) : bytes;
    const nl = data.lastIndexOf(0x0a);
    if (nl < 0) {
      t.pending = Buffer.from(data);
      return;
    }
    for (const r of parseRolloutLines(data.subarray(0, nl).toString("utf8"))) into.push(r);
    t.offset += nl + 1;
    t.pending = Buffer.from(data.subarray(nl + 1));
  }

  /** Finishes a read: accepts a complete trailing line and records the last timestamp. */
  endRead(threadId: string, lines: RolloutLine[]) {
    const t = this.get(threadId);
    // A strict prefix of a JSON object never parses, so a pending line that parses is a
    // complete record still waiting for its newline.
    if (t.pending.length) {
      const r = parseRolloutLine(t.pending.toString("utf8"));
      if (r) {
        lines.push(r);
        t.offset += t.pending.length;
        t.pending = EMPTY;
      }
    }
    for (const r of lines) if (r.timestamp) t.lastTs = r.timestamp;
  }

  /** Turns the records read in one poll (per thread) into events, in a stable order. */
  assemble(read: ReadonlyMap<string, RolloutLine[]>): GravitaEvent[] {
    // Map every thread before deciding spawns: a parent's spawn_agent output read in the
    // same poll as its child's first line already links them.
    const own = new Map<string, GravitaEvent[]>();
    for (const t of this.threads.values()) {
      const lines = read.get(t.threadId);
      if (lines?.length) own.set(t.threadId, t.normalizer.push(lines));
    }
    const out = [...(own.get(this.rootThreadId) ?? [])];
    for (const t of this.children())
      out.push(...this.spawnEvents(t), ...(own.get(t.threadId) ?? []));
    return out;
  }

  checkpoint(): CodexTailCheckpoint {
    const threads: CodexTailCheckpoint["threads"] = {};
    for (const t of this.threads.values()) {
      threads[t.threadId] = {
        path: t.path,
        offset: t.offset,
        ino: t.ino,
        ...(t.lastTs ? { lastTs: t.lastTs } : {}),
        state: structuredClone(t.normalizer.state),
      };
    }
    return {
      threads,
      spawned: [...this.threads.values()].filter((t) => t.spawned).map((t) => t.threadId),
    };
  }

  private track(
    threadId: string,
    path: string,
    meta: SessionMeta | undefined,
    cp?: CodexTailCheckpoint["threads"][string],
    spawned = false,
  ) {
    const isRoot = threadId === this.rootThreadId;
    const normalizer = new RolloutNormalizer(
      {
        projectId: this.projectId,
        sessionId: this.sessionId,
        agentId: isRoot ? MAIN_AGENT : codexAgentId(threadId),
        threadId,
        filePath: path,
      },
      cp?.state ? structuredClone(cp.state) : newThreadState(),
    );
    this.threads.set(threadId, {
      threadId,
      path,
      ...(meta ? { meta } : {}),
      offset: cp?.offset ?? 0,
      ino: cp?.ino ?? -1,
      pending: EMPTY,
      mtimeMs: 0,
      ...(cp?.lastTs ? { lastTs: cp.lastTs } : {}),
      normalizer,
      seenAt: this.now(),
      spawned,
    });
  }

  private reset(t: Track, ino: number) {
    t.ino = ino;
    t.offset = 0;
    t.pending = EMPTY;
  }

  private get(threadId: string): Track {
    const t = this.threads.get(threadId);
    if (!t) throw new Error(`untracked rollout: ${threadId}`);
    return t;
  }

  /** Subagents in a stable order: by when they started, then by id. */
  private children(): Track[] {
    return [...this.threads.values()]
      .filter((t) => t.threadId !== this.rootThreadId)
      .sort(
        (a, b) =>
          (a.meta?.ts ?? "").localeCompare(b.meta?.ts ?? "") ||
          a.threadId.localeCompare(b.threadId),
      );
  }

  /** The spawn_agent call that started `threadId`, as its parent's output named it. */
  private spawnCall(t: Track): string | undefined {
    const parent = t.meta?.parentThreadId;
    const owner = parent ? this.threads.get(parent) : undefined;
    return owner?.normalizer.state.spawned[t.threadId];
  }

  /** `agent.spawned` once the parent's spawn call is linked (or the grace ran out). */
  private spawnEvents(t: Track): GravitaEvent[] {
    if (t.spawned || !t.meta) return [];
    const call = this.spawnCall(t);
    if (!call && this.now() - t.seenAt < this.graceMs) return [];
    t.spawned = true;
    const meta = t.meta;
    const parentId = meta.parentThreadId;
    const parent =
      parentId === this.rootThreadId || !parentId || !this.threads.has(parentId)
        ? MAIN_AGENT
        : codexAgentId(parentId);
    const agentId = codexAgentId(t.threadId);
    return [
      {
        key: keys.agentSpawned(this.sessionId, agentId),
        ts: meta.ts ?? "",
        source: "codex-rollout",
        provider: "codex",
        projectId: this.projectId,
        sessionId: this.sessionId,
        agentId,
        type: "agent.spawned",
        data: {
          parentAgentId: parent,
          ...(call ? { spawnToolUseId: call } : {}),
          agentType: meta.spawn?.role ?? "default",
          ...(meta.spawn?.nickname ? { description: meta.spawn.nickname } : {}),
          depth: meta.spawn?.depth ?? 1,
          // Codex subagents run beside their parent, which collects them with wait_agent.
          background: false,
        },
      },
    ];
  }
}
