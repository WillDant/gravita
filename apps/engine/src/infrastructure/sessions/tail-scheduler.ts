import type { CheckpointStore } from "../../application/ports/checkpoint-store";
import type { Clock } from "../../application/ports/clock";
import type { StatusReporter } from "../../application/ports/event-publisher";
import type { Logger } from "../../application/ports/logger";
import type { SessionOwnership } from "../../application/ports/session-runtime";
import type {
  FoundSession,
  SessionSource,
  SessionTailReader,
} from "../../application/ports/session-source";
import type { AnnounceProject } from "../../application/usecases/announce-project";
import type { IngestEvents } from "../../application/usecases/ingest-events";
import { isHot } from "../../domain/hotness";

// Keeps one reader per session found by any source (Claude Code's transcripts, Codex's
// rollouts): new sessions are indexed newest first, hot ones are polled fast and cold ones
// only when their files changed. One scheduler for every source, so each session has one
// writer, every checkpoint lives in one store, and indexing progress is one count.

export interface TailSchedulerOptions {
  sources: readonly SessionSource[];
  ingest: IngestEvents;
  checkpoints: CheckpointStore;
  projects: AnnounceProject;
  status: StatusReporter;
  clock: Clock;
  logger: Logger;
  /** Sessions a Gravita runtime writes itself are skipped until the runtime ends. */
  ownership: SessionOwnership;
  discoveryMs?: number;
  hotPollMs?: number;
}

interface Tracked extends FoundSession {
  source: SessionSource;
  polledMtimeMs: number;
  polledSize: number;
  reader?: SessionTailReader;
  projectId?: string;
  checkpoint: string;
  indexed: boolean;
  busy: boolean;
}

export class TailScheduler {
  private readonly sessions = new Map<string, Tracked>();
  private discoverTimer: ReturnType<typeof setTimeout> | undefined;
  private hotTimer: ReturnType<typeof setInterval> | undefined;
  private hotPolling = false;
  private stopped = false;

  constructor(private readonly o: TailSchedulerOptions) {}

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
      this.o.logger.log("discovery failed", err);
    }
    if (!this.stopped)
      this.discoverTimer = setTimeout(() => void this.discoverLoop(), this.o.discoveryMs ?? 2_000);
  }

  /** One discovery pass: index new sessions (newest first), then re-read changed cold ones. */
  async discover() {
    const fresh: Tracked[] = [];
    for (const source of this.o.sources) {
      let found: FoundSession[];
      try {
        found = await source.scan((id) => this.sessions.has(id));
      } catch (err) {
        this.o.logger.log(`${source.name} discovery failed`, err);
        continue;
      }
      for (const f of found) {
        const known = this.sessions.get(f.sessionId);
        if (known) {
          if (known.path !== f.path || known.source !== source) continue;
          known.mtimeMs = f.mtimeMs;
          known.size = f.size;
          continue;
        }
        const t: Tracked = {
          ...f,
          source,
          polledMtimeMs: -1,
          polledSize: -1,
          checkpoint: "",
          indexed: false,
          busy: false,
        };
        this.sessions.set(f.sessionId, t);
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

  private isHot(t: Tracked): boolean {
    return isHot({ mtimeMs: t.mtimeMs, live: t.source.isLive(t.sessionId) }, this.o.clock.now());
  }

  private async pollSession(t: Tracked) {
    if (t.busy) return;
    if (this.o.ownership.isOwned(t.sessionId)) {
      // Its runtime is the writer; the tail resumes from its checkpoint once it ends.
      this.markIndexed(t);
      return;
    }
    t.busy = true;
    t.polledMtimeMs = t.mtimeMs;
    t.polledSize = t.size;
    try {
      if (!t.reader && !(await this.open(t))) return;
      const reader = t.reader!;
      const events = await reader.poll();
      const checkpoint = reader.checkpoint();
      if (!events.length && checkpoint === t.checkpoint) return;
      t.checkpoint = checkpoint;
      const saved = { path: t.path, projectId: t.projectId!, checkpoint };
      this.o.ingest.execute(events, () => this.o.checkpoints.save(t.sessionId, saved));
    } catch (err) {
      this.o.logger.log(`failed to read session ${t.sessionId}`, err);
    } finally {
      t.busy = false;
      this.markIndexed(t);
    }
  }

  /** Resumes from the saved checkpoint, or reads the session's cwd to find its project. */
  private async open(t: Tracked): Promise<boolean> {
    const saved = this.o.checkpoints.load(t.sessionId);
    const resume = saved?.path === t.path && t.source.resumable(saved.checkpoint);
    let projectId: string;
    if (saved && resume) {
      projectId = saved.projectId;
      t.checkpoint = saved.checkpoint;
    } else {
      const head = await t.source.head(t);
      if (!head) return false;
      projectId = (await this.o.projects.execute(head.cwd, head.ts)).id;
    }
    t.projectId = projectId;
    t.reader = t.source.open(t, {
      projectId,
      ...(saved && resume ? { checkpoint: saved.checkpoint } : {}),
    });
    return true;
  }

  private markIndexed(t: Tracked) {
    if (t.indexed) return;
    t.indexed = true;
    this.reportIndexing();
  }

  private reportIndexing() {
    let done = 0;
    for (const t of this.sessions.values()) if (t.indexed) done++;
    this.o.status.updateStatus({ indexing: { done, total: this.sessions.size } });
  }
}
