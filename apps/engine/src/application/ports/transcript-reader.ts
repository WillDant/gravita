import type { ConversationMessage } from "@gravita/protocol";

/** Reads a session's own record (read-only) for what events don't carry in full. */
export interface TranscriptReader {
  /** The main agent's messages with full text; empty when there is no transcript (yet). */
  conversation(sessionId: string): Promise<ConversationMessage[]>;
}
