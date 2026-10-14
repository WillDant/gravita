import { type AgentProvider, type ConversationMessage, DEFAULT_PROVIDER } from "@gravita/protocol";
import type { TranscriptReader } from "../ports/transcript-reader";

/**
 * Sends `session.conversation` to the reader of the session's provider: Claude Code's
 * transcripts or Codex's rollouts. A provider without a reader has no conversation.
 */
export class TranscriptRouter implements TranscriptReader {
  constructor(
    private readonly readers: Partial<Record<AgentProvider, TranscriptReader>>,
    private readonly providerOf: (sessionId: string) => string | undefined,
  ) {}

  conversation(sessionId: string): Promise<ConversationMessage[]> {
    const provider = this.providerOf(sessionId) ?? DEFAULT_PROVIDER;
    const reader = this.readers[provider as AgentProvider];
    return reader ? reader.conversation(sessionId) : Promise.resolve([]);
  }
}
