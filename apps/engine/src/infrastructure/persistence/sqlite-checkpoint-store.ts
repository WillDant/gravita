import type { Database } from "bun:sqlite";
import type { CheckpointStore, SavedTail } from "../../application/ports/checkpoint-store";

export class SqliteCheckpointStore implements CheckpointStore {
  private readonly loadStmt;
  private readonly saveStmt;

  constructor(db: Database) {
    this.loadStmt = db.query<{ path: string; project_id: string; checkpoint: string }, [string]>(
      "SELECT path, project_id, checkpoint FROM tails WHERE session_id = ?",
    );
    this.saveStmt = db.query<never, [string, string, string, string]>(
      "INSERT INTO tails (session_id, path, project_id, checkpoint) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT (session_id) DO UPDATE SET path = excluded.path, project_id = excluded.project_id, checkpoint = excluded.checkpoint",
    );
  }

  load(sessionId: string): SavedTail | undefined {
    const r = this.loadStmt.get(sessionId);
    return r ? { path: r.path, projectId: r.project_id, checkpoint: r.checkpoint } : undefined;
  }

  save(sessionId: string, t: SavedTail) {
    this.saveStmt.run(sessionId, t.path, t.projectId, t.checkpoint);
  }
}
