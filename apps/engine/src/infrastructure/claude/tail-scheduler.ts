import { readSessionHead, SessionTail, type TailCheckpoint } from "@gravita/adapter-claude";
import type { CheckpointStore } from "../../application/ports/checkpoint-store";
import type { Clock } from "../../application/ports/clock";
import type { StatusReporter } from "../../application/ports/event-publisher";
import type { Logger } from "../../application/ports/logger";
import type { SessionOwnership } from "../../application/ports/session-runtime";
import type { AnnounceProject } from "../../application/usecases/announce-project";
import type { IngestEvents } from "../../application/usecases/ingest-events";
import { isHot } from "../../domain/hotness";
import type { TranscriptDiscovery } from "./transcript-discovery";

// Keeps one SessionTail per discovered transcript: new sessions are indexed newest first,
// hot ones are polled fast and cold ones only when their file changed.

export interface TailSchedulerOptions {
  discovery: TranscriptDiscovery;
  ingest: IngestEvents;
  checkpoints: CheckpointStore;
  projects: AnnounceProject;
  status: StatusReporter;
  clock: Clock;
  logger: Logger;
  /** True while the session's process is alive (registry). */
  isLive: (sessionId: string) => boolean;
  /** Sessions a Gravita runtime writes itself are skipped until the runtime ends. */
  ownership: SessionOwnership;
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
    const found = await this.o.discovery.scan((id) => this.sessions.has(id));
    const fresh: Tracked[] = [];
    for (const f of found) {
      const known = this.sessions.get(f.sessionId);
      if (known) {
        if (known.path !== f.path) continue;
        known.mtimeMs = f.mtimeMs;
        known.size = f.size;
        continue;
      }
      const t: Tracked = {
        ...f,
        polledMtimeMs: -1,
        polledSize: -1,
        checkpoint: "",
        indexed: false,
        busy: false,
      };
      this.sessions.set(f.sessionId, t);
      fresh.push(t);
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
    return isHot({ mtimeMs: t.mtimeMs, live: this.o.isLive(t.sessionId) }, this.o.clock.now());
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
      if (!t.tail && !(await this.initTail(t))) return;
      const tail = t.tail!;
      const events = await tail.poll();
      const checkpoint = JSON.stringify(tail.checkpoint());
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
  private async initTail(t: Tracked): Promise<boolean> {
    const saved = this.o.checkpoints.load(t.sessionId);
    const checkpoint = saved?.path === t.path ? parseCheckpoint(saved.checkpoint) : undefined;
    let projectId: string;
    if (saved && checkpoint) {
      projectId = saved.projectId;
      t.checkpoint = saved.checkpoint;
    } else {
      const head = await readSessionHead(t.path);
      if (!head) return false;
      projectId = (await this.o.projects.execute(head.cwd, head.ts)).id;
    }
    t.projectId = projectId;
    t.tail = new SessionTail(t.path, {
      projectId,
      now: () => this.o.clock.now(),
      ...(checkpoint ? { checkpoint } : {}),
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
