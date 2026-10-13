import type { ConversationMessage } from "@gravita/protocol";
import type { TranscriptReader } from "../ports/transcript-reader";

/** The main agent's messages with full text, for any session (Gravita-run or external). */
export class GetConversation {
  constructor(private readonly transcripts: TranscriptReader) {}

  async execute(p: { sessionId: string }): Promise<{ messages: ConversationMessage[] }> {
    return { messages: await this.transcripts.conversation(p.sessionId) };
  }
}
