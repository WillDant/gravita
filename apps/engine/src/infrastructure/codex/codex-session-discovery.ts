import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  type CodexSessionFiles,
  codexSessionId,
  groupThreads,
  nodeRolloutFs,
  type RolloutFs,
  readRolloutHead,
  type SessionMeta,
  THREAD_ID,
  type ThreadFile,
  threadIdOfFile,
} from "@gravita/adapter-codex";
import type { Clock } from "../../application/ports/clock";
import type { FoundSession } from "../../application/ports/session-source";

// Finds Codex rollouts under <codexHome>/sessions/YYYY/MM/DD/rollout-*.jsonl and groups
// each root thread with its subagents' rollouts. Read-only, and only ever under
// `sessions/`: never auth.json, config.toml, the SQLite state or history.jsonl, and never
// archived_sessions/. Symlinks are never followed.

const DAY_MS = 86_400_000;
/** Older date folders are swept this rarely: a resumed old session appends to its old file. */
const FULL_SWEEP_MS = 5 * 60_000;

export interface CodexFoundSession extends FoundSession {
  files: CodexSessionFiles;
}

/** The directory calls discovery makes, injectable so tests can audit every path it touches. */
export interface CodexDiscoveryFs {
  readdir(path: string): Promise<Dirent[]>;
  stat(path: string): Promise<{ mtimeMs: number; size: number }>;
}

export const nodeCodexDiscoveryFs: CodexDiscoveryFs = {
  readdir: (path) => readdir(path, { withFileTypes: true }),
  stat: (path) => stat(path),
};

export interface CodexSessionDiscoveryOptions {
  codexHome: string;
  lookbackDays: number;
  clock: Clock;
  fs?: CodexDiscoveryFs;
  /** How rollout heads are read. */
  rolloutFs?: RolloutFs;
  /** Told about files that can't be used (debug logs). */
  onSkip?: (path: string, reason: string) => void;
}

interface FileInfo {
  path: string;
  mtimeMs: number;
  size: number;
  /** undefined: not read yet; null: no session meta yet (read again when it grows). */
  meta?: SessionMeta | null;
  headSize?: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A local date as Codex names its folders: "YYYY-MM-DD". */
function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** When a UUID v7 thread id was made, from its first 48 bits; undefined for other versions. */
export function threadCreatedMs(threadId: string): number | undefined {
  if (!THREAD_ID.test(threadId) || threadId[14] !== "7") return undefined;
  const ms = Number.parseInt(threadId.slice(0, 8) + threadId.slice(9, 13), 16);
  return Number.isFinite(ms) ? ms : undefined;
}

async function dirs(fs: CodexDiscoveryFs, path: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(path);
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && /^\d+$/.test(e.name))
    .map((e) => e.name)
    .sort();
}

export class CodexSessionDiscovery {
  private readonly files = new Map<string, FileInfo>();
  private lastFullSweep = Number.NEGATIVE_INFINITY;
  /**
   * Threads `locate` looked for in every folder and didn't find, and when. An orphaned
   * subagent (its root archived or deleted) would otherwise walk the whole tree each scan:
   * a miss is looked for again no sooner than a full sweep, or when its file shows up.
   */
  private readonly misses = new Map<string, number>();
  private readonly fs: CodexDiscoveryFs;
  private readonly rolloutFs: RolloutFs;

  constructor(private readonly o: CodexSessionDiscoveryOptions) {
    this.fs = o.fs ?? nodeCodexDiscoveryFs;
    this.rolloutFs = o.rolloutFs ?? nodeRolloutFs;
  }

  private get root() {
    return join(this.o.codexHome, "sessions");
  }

  /**
   * Every session worth looking at: the known ones (so their files stay fresh, and new
   * subagents join them) and new ones written within the lookback window. Date folders
   * before the window are walked only every few minutes.
   */
  async scan(isKnown: (sessionId: string) => boolean): Promise<CodexFoundSession[]> {
    const now = this.o.clock.now();
    const cutoff = now - this.o.lookbackDays * DAY_MS;
    // A day of slack: folders are named in local time.
    const fromKey = dayKey(cutoff - DAY_MS);
    const full = now - this.lastFullSweep >= FULL_SWEEP_MS;
    if (full) this.lastFullSweep = now;

    const seen = new Set<string>();
    for (const day of await this.dayFolders(full ? undefined : fromKey)) {
      for (const path of await this.rollouts(day)) {
        seen.add(path);
        await this.refresh(path, cutoff);
      }
    }
    // Files of known sessions outside the folders walked this time.
    for (const f of this.files.values()) if (!seen.has(f.path)) await this.refresh(f.path, cutoff);
    await this.findMissingRoots(cutoff);

    const threads: ThreadFile[] = [];
    for (const f of this.files.values()) if (f.meta) threads.push({ path: f.path, meta: f.meta });
    const out: CodexFoundSession[] = [];
    for (const files of groupThreads(threads)) {
      const all = [files.root, ...files.subagents].map((t) => this.files.get(t.path)!);
      const mtimeMs = Math.max(...all.map((f) => f.mtimeMs));
      const sessionId = codexSessionId(files.root.meta.threadId);
      if (mtimeMs < cutoff && !isKnown(sessionId)) continue;
      const size = all.reduce((n, f) => n + f.size, 0);
      out.push({ sessionId, path: files.root.path, mtimeMs, size, files });
    }
    return out;
  }

  /** The rollout of one thread, by the date its v7 id encodes (a missing root, say). */
  async locate(threadId: string): Promise<string | undefined> {
    const known = [...this.files.values()].find((f) => f.meta?.threadId === threadId);
    if (known) {
      this.misses.delete(threadId);
      return known.path;
    }
    const now = this.o.clock.now();
    const missed = this.misses.get(threadId);
    if (missed !== undefined && now - missed < FULL_SWEEP_MS) return undefined;
    const created = threadCreatedMs(threadId);
    // First where its id dates it (a day either way: folders are local time), then
    // everywhere, newest first.
    const likely =
      created === undefined
        ? []
        : [-DAY_MS, 0, DAY_MS].map((d) => {
            const [y, m, day] = dayKey(created + d).split("-");
            return join(this.root, y!, m!, day!);
          });
    const rest = (await this.dayFolders(undefined)).reverse().filter((d) => !likely.includes(d));
    for (const day of [...likely, ...rest]) {
      for (const path of await this.rollouts(day)) {
        if (threadIdOfFile(basename(path)) !== threadId) continue;
        this.misses.delete(threadId);
        return path;
      }
    }
    this.misses.set(threadId, now);
    return undefined;
  }

  /** `sessions/YYYY/MM/DD` folders from `fromKey` on (all of them when undefined). */
  private async dayFolders(fromKey: string | undefined): Promise<string[]> {
    const out: string[] = [];
    const [fy, fm, fd] = fromKey?.split("-") ?? [];
    for (const y of await dirs(this.fs, this.root)) {
      if (fy && y < fy) continue;
      for (const m of await dirs(this.fs, join(this.root, y))) {
        if (fy && `${y}-${m}` < `${fy}-${fm}`) continue;
        for (const d of await dirs(this.fs, join(this.root, y, m))) {
          if (fy && `${y}-${m}-${d}` < `${fy}-${fm}-${fd}`) continue;
          out.push(join(this.root, y, m, d));
        }
      }
    }
    return out;
  }

  private async rollouts(day: string): Promise<string[]> {
    let entries: Dirent[];
    try {
      entries = await this.fs.readdir(day);
    } catch {
      return [];
    }
    // isFile() is false for symlinks: never follow a link out of the sessions tree.
    return entries
      .filter((e) => e.isFile() && threadIdOfFile(e.name))
      .map((e) => join(day, e.name));
  }

  /** Stats a rollout, and reads its head when it is recent and not read yet (or grew). */
  private async refresh(path: string, cutoff: number) {
    const st = await this.fs.stat(path).catch(() => null);
    if (!st) {
      this.files.delete(path);
      return;
    }
    let f = this.files.get(path);
    if (!f) {
      if (st.mtimeMs < cutoff) return;
      f = { path, mtimeMs: st.mtimeMs, size: st.size };
      this.files.set(path, f);
    }
    f.mtimeMs = st.mtimeMs;
    f.size = st.size;
    if (f.meta || (f.meta === null && f.headSize === st.size)) return;
    f.headSize = st.size;
    f.meta = await readRolloutHead(path, this.rolloutFs).catch(() => null);
    if (f.meta) this.misses.delete(f.meta.threadId);
    if (f.meta === null && path.endsWith(".zst"))
      this.o.onSkip?.(path, "compressed rollout could not be read");
  }

  /** Subagents whose root rollout lies outside the folders walked: find it by its id. */
  private async findMissingRoots(cutoff: number) {
    const known = new Set<string>();
    for (const f of this.files.values()) if (f.meta) known.add(f.meta.threadId);
    for (const f of [...this.files.values()]) {
      const m = f.meta;
      if (m?.role !== "subagent") continue;
      for (const id of [m.rootThreadId, m.parentThreadId]) {
        if (!id || known.has(id)) continue;
        known.add(id);
        const path = await this.locate(id);
        if (!path) continue;
        // Read it whatever its age: a subagent written now makes its session current.
        const st = await this.fs.stat(path).catch(() => null);
        if (!st) continue;
        this.files.set(path, { path, mtimeMs: st.mtimeMs, size: st.size });
        await this.refresh(path, cutoff);
      }
    }
  }
}
