import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { readSessionHead, SessionTail, type TailCheckpoint } from "@gravita/adapter-claude";
import type { Hub } from "../hub";
import { log } from "../log";
import type { ProjectResolver } from "../projects";

// Finds Claude Code transcripts under <claudeHome>/projects/*/<session>.jsonl and keeps
// one SessionTail per session. Read-only: nothing is ever written under claudeHome.

const SESSION_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i;
const DAY_MS = 86_400_000;
/** Sessions written to this recently are polled fast. */
export const HOT_WINDOW_MS = 10 * 60_000;
/** Transcripts older than the lookback window are re-checked this rarely. */
const STALE_RECHECK_MS = 60_000;

export interface ClaudeIngestOptions {
  claudeHome: string;
  lookbackDays: number;
  hub: Hub;
  projects: ProjectResolver;
  /** True while the session's process is alive (registry). */
  isLive: (sessionId: string) => boolean;
  discoveryMs?: number;
  hotPollMs?: number;
}

interface Tracked {
  sessionId: string;
  path: string;
  mtimeMs: number;
  size: number;
  polledMtimeMs: number;
  polledSize: number;
  tail?: SessionTail;
  projectId?: string;
  checkpoint: string;
  indexed: boolean;
  busy: boolean;
}

function parseCheckpoint(json: string): TailCheckpoint | undefined {
  try {
    const cp = JSON.parse(json) as TailCheckpoint;
    return cp && typeof cp === "object" && cp.files && typeof cp.files === "object"
      ? cp
      : undefined;
  } catch {
    return undefined;
  }
}

export class ClaudeIngest {
  private readonly sessions = new Map<string, Tracked>();
  /** Out-of-window transcripts → when to stat them again. */
  private readonly stale = new Map<string, number>();
  private discoverTimer: ReturnType<typeof setTimeout> | undefined;
  private hotTimer: ReturnType<typeof setInterval> | undefined;
  private hotPolling = false;
  private stopped = false;

  constructor(private readonly o: ClaudeIngestOptions) {}

  start() {
    void this.discoverLoop();
    this.hotTimer = setInterval(() => void this.pollHot(), this.o.hotPollMs ?? 300);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.discoverTimer);
    clearInterval(this.hotTimer);
  }

  private async discoverLoop() {
    try {
      await this.discover();
    } catch (err) {
      log("discovery failed", err);
    }
    if (!this.stopped)
      this.discoverTimer = setTimeout(() => void this.discoverLoop(), this.o.discoveryMs ?? 2_000);
  }

  /** One discovery pass: index new sessions (newest first), then re-read changed cold ones. */
  async discover() {
    const root = join(this.o.claudeHome, "projects");
    const cutoff = Date.now() - this.o.lookbackDays * DAY_MS;
    let dirs: Dirent[];
    try {
      dirs = await readdir(root, { withFileTypes: true });
    } catch {
      return;
    }
    const fresh: Tracked[] = [];
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      let entries: Dirent[];
      try {
        entries = await readdir(join(root, d.name), { withFileTypes: true });
      } catch {
        continue;
      }
      for (const f of entries) {
        // isFile() is false for symlinks: never follow a link out of the transcripts tree.
        if (!f.isFile() || !SESSION_FILE.test(f.name)) continue;
        const path = join(root, d.name, f.name);
        const sessionId = f.name.slice(0, -".jsonl".length);
        const recheckAt = this.stale.get(path);
        if (recheckAt !== undefined && Date.now() < recheckAt && !this.o.isLive(sessionId))
          continue;
        const st = await stat(path).catch(() => null);
        if (!st) continue;
        const known = this.sessions.get(sessionId);
        if (known) {
          if (known.path !== path) continue;
          known.mtimeMs = st.mtimeMs;
          known.size = st.size;
          continue;
        }
        if (st.mtimeMs < cutoff) {
          this.stale.set(path, Date.now() + STALE_RECHECK_MS);
          continue;
        }
        this.stale.delete(path);
        const t: Tracked = {
          sessionId,
          path,
          mtimeMs: st.mtimeMs,
          size: st.size,
          polledMtimeMs: -1,
          polledSize: -1,
          checkpoint: "",
          indexed: false,
          busy: false,
        };
        this.sessions.set(sessionId, t);
        fresh.push(t);
      }
    }
    if (fresh.length) this.reportIndexing();
    fresh.sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const t of fresh) {
      if (this.stopped) return;
      await this.pollSession(t);
    }
    for (const t of this.sessions.values()) {
      if (this.stopped) return;
      if (!t.indexed || this.isHot(t)) continue;
      if (t.mtimeMs !== t.polledMtimeMs || t.size !== t.polledSize) await this.pollSession(t);
    }
  }

  private isHot(t: Tracked): boolean {
    return Date.now() - t.mtimeMs < HOT_WINDOW_MS || this.o.isLive(t.sessionId);
  }

  async pollHot() {
    if (this.hotPolling || this.stopped) return;
    this.hotPolling = true;
    try {
      for (const t of this.sessions.values()) {
        if (this.stopped) return;
        if (t.indexed && this.isHot(t)) await this.pollSession(t);
      }
    } finally {
      this.hotPolling = false;
    }
  }

  private async pollSession(t: Tracked) {
    if (t.busy) return;
    t.busy = true;
    t.polledMtimeMs = t.mtimeMs;
    t.polledSize = t.size;
    try {
      if (!t.tail && !(await this.initTail(t))) return;
      const tail = t.tail!;
      const events = await tail.poll();
      const checkpoint = JSON.stringify(tail.checkpoint());
      if (!events.length && checkpoint === t.checkpoint) return;
      t.checkpoint = checkpoint;
      const saved = { path: t.path, projectId: t.projectId!, checkpoint };
      this.o.hub.ingest(events, () => this.o.hub.store.saveTail(t.sessionId, saved));
    } catch (err) {
      log(`failed to read session ${t.sessionId}`, err);
    } finally {
      t.busy = false;
      if (!t.indexed) {
        t.indexed = true;
        this.reportIndexing();
      }
    }
  }

  /** Resumes from the saved checkpoint, or reads the session's cwd to find its project. */
  private async initTail(t: Tracked): Promise<boolean> {
    const saved = this.o.hub.store.loadTail(t.sessionId);
    const checkpoint = saved?.path === t.path ? parseCheckpoint(saved.checkpoint) : undefined;
    let projectId: string;
    if (saved && checkpoint) {
      projectId = saved.projectId;
      t.checkpoint = saved.checkpoint;
    } else {
      const head = await readSessionHead(t.path);
      if (!head) return false;
      projectId = (await this.o.projects.announce(head.cwd, head.ts)).id;
    }
    t.projectId = projectId;
    t.tail = new SessionTail(t.path, { projectId, ...(checkpoint ? { checkpoint } : {}) });
    return true;
  }

  private reportIndexing() {
    let done = 0;
    for (const t of this.sessions.values()) if (t.indexed) done++;
    this.o.hub.updateStatus({ indexing: { done, total: this.sessions.size } });
  }
}
