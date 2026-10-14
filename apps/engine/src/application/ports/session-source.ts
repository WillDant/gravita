import type { GravitaEvent } from "@gravita/protocol";

// Where external sessions come from: a provider's own files (Claude Code's transcripts,
// Codex's rollouts), found on disk and read incrementally. The tail scheduler drives every
// source the same way: one reader per session, one checkpoint per session.

/** A session found on disk. */
export interface FoundSession {
  /** Gravita's id for it; ids of different providers never collide (Codex's are prefixed). */
  sessionId: string;
  /** The file its checkpoint belongs to: the main transcript, or the root rollout. */
  path: string;
  /** Newest mtime and total size of its files: when either changes, there's more to read. */
  mtimeMs: number;
  size: number;
}

/** Where a session starts: its working directory (for its project) and first timestamp. */
export interface SessionHead {
  cwd: string;
  ts: string;
}

/** Reads one session incrementally. */
export interface SessionTailReader {
  /** Whatever was written since the last poll, as events. */
  poll(): Promise<GravitaEvent[]>;
  /** Progress to resume from after a restart (opaque JSON). */
  checkpoint(): string;
}

export interface SessionSource {
  /** For logs. */
  readonly name: string;
  /**
   * The sessions worth looking at: the known ones (so their mtime and size stay fresh) and
   * new ones written within the lookback window.
   */
  scan(isKnown: (sessionId: string) => boolean): Promise<FoundSession[]>;
  /** Null while the session's start isn't written yet. */
  head(found: FoundSession): Promise<SessionHead | null>;
  /** Whether a saved checkpoint (JSON) is one this source can resume from. */
  resumable(checkpoint: string): boolean;
  /** A reader for the session, resuming from `checkpoint` when given. */
  open(found: FoundSession, o: { projectId: string; checkpoint?: string }): SessionTailReader;
  /** True while the session is known to be running: it is polled fast. */
  isLive(sessionId: string): boolean;
}
