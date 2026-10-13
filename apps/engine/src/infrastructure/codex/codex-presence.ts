import { STALE_MS } from "@gravita/core";
import type { GravitaEvent } from "@gravita/protocol";
import type { Clock } from "../../application/ports/clock";
import type { IngestEvents } from "../../application/usecases/ingest-events";
import { CODEX } from "./provider";

// Codex has no live registry like Claude Code's sessions/<pid>.json, so presence is inferred
// from the rollouts: a session whose turn is open is busy, one written to recently is idle,
// and one that stopped being written to is detached. A long command may write nothing for a
// while, so an open turn is trusted for longer than a quiet one.

/** An open turn with no writes for this long is taken as abandoned (a killed process). */
export const OPEN_TURN_STALE_MS = 30 * 60_000;
/** A session between turns counts as running this long after its last write. */
export const IDLE_STALE_MS = STALE_MS;

type Status = "busy" | "idle";

interface Live {
  projectId: string;
  status: Status;
  openTurn: boolean;
  lastWriteMs: number;
}

export interface CodexPresenceOptions {
  ingest: IngestEvents;
  clock: Clock;
  intervalMs?: number;
}

export class CodexPresence {
  private readonly live = new Map<string, Live>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly o: CodexPresenceOptions) {}

  readonly isLive = (sessionId: string): boolean => this.live.has(sessionId);

  start() {
    this.timer = setInterval(() => this.tick(), this.o.intervalMs ?? 5_000);
  }

  stop() {
    clearInterval(this.timer);
  }

  /** What a poll of a session found: whether a turn is open and when it was last written. */
  observe(sessionId: string, projectId: string, openTurn: boolean, lastWriteMs: number) {
    const now = this.o.clock.now();
    const status: Status = openTurn ? "busy" : "idle";
    const fresh = now - lastWriteMs < (openTurn ? OPEN_TURN_STALE_MS : IDLE_STALE_MS);
    const prev = this.live.get(sessionId);
    if (!fresh) {
      // History being indexed stays quiet; a session that was running detaches.
      if (prev) this.detach(sessionId, prev, now);
      return;
    }
    this.live.set(sessionId, { projectId, status, openTurn, lastWriteMs });
    if (prev?.status === status) return;
    this.emit({
      key: `presence:${sessionId}:${status}:${now}`,
      ts: new Date(now).toISOString(),
      source: "codex-rollout",
      provider: CODEX,
      projectId,
      sessionId,
      type: "session.presence",
      data: { status },
    });
  }

  /** Detaches the sessions that went quiet since their last poll. */
  tick() {
    const now = this.o.clock.now();
    for (const [sessionId, l] of this.live) {
      const limit = l.openTurn ? OPEN_TURN_STALE_MS : IDLE_STALE_MS;
      if (now - l.lastWriteMs >= limit) this.detach(sessionId, l, now);
    }
  }

  private detach(sessionId: string, l: Live, now: number) {
    this.live.delete(sessionId);
    this.emit({
      key: `detached:${sessionId}:${now}`,
      ts: new Date(now).toISOString(),
      source: "codex-rollout",
      provider: CODEX,
      projectId: l.projectId,
      sessionId,
      type: "session.detached",
      data: { reason: "stale" },
    });
  }

  private emit(e: GravitaEvent) {
    this.o.ingest.execute([e]);
  }
}
