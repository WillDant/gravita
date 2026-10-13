import { Database } from "bun:sqlite";

// One SQLite file holds the event log and the tail checkpoints, so a checkpoint and the
// events it produced commit in the same transaction.

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

/** `path` is a file path, or ":memory:" (demo mode). */
export function openDatabase(path: string): Database {
  const db = new Database(path, { create: true, strict: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec(SCHEMA);
  return db;
}
