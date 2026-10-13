import type { Database } from "bun:sqlite";
import type { GravitaEvent } from "@gravita/protocol";
import type { EventStore } from "../../application/ports/event-store";

export class SqliteEventStore implements EventStore {
  private readonly insertStmt;
  private readonly sessionStmt;

  constructor(private readonly db: Database) {
    this.insertStmt = db.query<never, [string, string, string, string, string | null, string]>(
      "INSERT OR IGNORE INTO events (key, ts, type, project_id, session_id, json) VALUES (?, ?, ?, ?, ?, ?)",
    );
    this.sessionStmt = db.query<{ json: string }, [string]>(
      "SELECT json FROM events WHERE session_id = ? ORDER BY seq",
    );
  }

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
}
