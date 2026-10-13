import { Database } from "bun:sqlite";
import type { GravitaEvent } from "@gravita/protocol";

// Append-only event log. Idempotency keys are UNIQUE, so re-reading a transcript or
// receiving the same fact from two sources stores it once.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  ts TEXT,
  type TEXT,
  project_id TEXT,
  session_id TEXT,
  json TEXT
);
CREATE INDEX IF NOT EXISTS events_session ON events (session_id, seq);
CREATE TABLE IF NOT EXISTS tails (
  session_id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  project_id TEXT NOT NULL,
  checkpoint TEXT NOT NULL
);
`;

export interface SavedTail {
  path: string;
  projectId: string;
  checkpoint: string;
}

export class Store {
  private readonly db: Database;
  private readonly insertStmt;
  private readonly sessionStmt;
  private readonly loadTailStmt;
  private readonly saveTailStmt;

  /** `path` is a file path, or ":memory:" (demo mode). */
  constructor(path: string) {
    this.db = new Database(path, { create: true, strict: true });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = NORMAL");
    this.db.exec(SCHEMA);
    this.insertStmt = this.db.query<never, [string, string, string, string, string | null, string]>(
      "INSERT OR IGNORE INTO events (key, ts, type, project_id, session_id, json) VALUES (?, ?, ?, ?, ?, ?)",
    );
    this.sessionStmt = this.db.query<{ json: string }, [string]>(
      "SELECT json FROM events WHERE session_id = ? ORDER BY seq",
    );
    this.loadTailStmt = this.db.query<
      { path: string; project_id: string; checkpoint: string },
      [string]
    >("SELECT path, project_id, checkpoint FROM tails WHERE session_id = ?");
    this.saveTailStmt = this.db.query<never, [string, string, string, string]>(
      "INSERT INTO tails (session_id, path, project_id, checkpoint) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT (session_id) DO UPDATE SET path = excluded.path, project_id = excluded.project_id, checkpoint = excluded.checkpoint",
    );
  }

  /** Stores the event unless its key exists. Returns its seq, or null for a duplicate. */
  insert(e: GravitaEvent): number | null {
    const r = this.insertStmt.run(
      e.key,
      e.ts,
      e.type,
      e.projectId,
      e.sessionId ?? null,
      JSON.stringify(e),
    );
    return r.changes === 1 ? Number(r.lastInsertRowid) : null;
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  maxSeq(): number {
    return (
      this.db.query<{ seq: number | null }, []>("SELECT MAX(seq) AS seq FROM events").get()?.seq ??
      0
    );
  }

  *allEvents(): Generator<GravitaEvent> {
    for (const row of this.db
      .query<{ json: string }, []>("SELECT json FROM events ORDER BY seq")
      .iterate()) {
      yield JSON.parse(row.json) as GravitaEvent;
    }
  }

  sessionEvents(sessionId: string): GravitaEvent[] {
    return this.sessionStmt.all(sessionId).map((r) => JSON.parse(r.json) as GravitaEvent);
  }

  loadTail(sessionId: string): SavedTail | undefined {
    const r = this.loadTailStmt.get(sessionId);
    return r ? { path: r.path, projectId: r.project_id, checkpoint: r.checkpoint } : undefined;
  }

  saveTail(sessionId: string, t: SavedTail) {
    this.saveTailStmt.run(sessionId, t.path, t.projectId, t.checkpoint);
  }

  close() {
    this.db.close();
  }
}
