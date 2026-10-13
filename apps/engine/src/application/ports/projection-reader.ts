import type { SessionState } from "@gravita/core";

/** Read-only queries on the live projection. Results are copies, never the live state. */
export interface ProjectionReader {
  session(sessionId: string): SessionState | undefined;
}
