/** Where a source resumes reading a session after a restart. */
export interface SavedTail {
  path: string;
  projectId: string;
  /** Opaque, source-defined progress (JSON). */
  checkpoint: string;
}

export interface CheckpointStore {
  load(sessionId: string): SavedTail | undefined;
  save(sessionId: string, tail: SavedTail): void;
}
