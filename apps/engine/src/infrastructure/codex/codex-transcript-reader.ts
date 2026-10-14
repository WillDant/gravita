import {
  codexConversationOf,
  decompressRollout,
  isCompressed,
  nodeRolloutFs,
  parseRolloutLines,
  type RolloutFs,
  THREAD_ID,
  threadIdOf,
} from "@gravita/adapter-codex";
import type { ConversationMessage } from "@gravita/protocol";
import type { TranscriptReader } from "../../application/ports/transcript-reader";

// Reads a Codex session's root rollout, read-only, to give the Conversation lens full
// message text. The session id is validated (it becomes part of a file name).

export interface CodexTranscriptReaderOptions {
  /** The rollout of a thread under <codexHome>/sessions, or undefined. */
  locate: (threadId: string) => Promise<string | undefined>;
  fs?: RolloutFs;
}

export class CodexTranscriptReader implements TranscriptReader {
  constructor(private readonly o: CodexTranscriptReaderOptions) {}

  async conversation(sessionId: string): Promise<ConversationMessage[]> {
    const threadId = threadIdOf(sessionId);
    if (!threadId || !THREAD_ID.test(threadId)) return [];
    const path = await this.o.locate(threadId);
    if (!path) return [];
    const fs = this.o.fs ?? nodeRolloutFs;
    const bytes = await fs.readFile(path).catch(() => null);
    const data = bytes && isCompressed(path) ? decompressRollout(bytes) : bytes;
    if (!data) return [];
    return codexConversationOf(parseRolloutLines(Buffer.from(data).toString("utf8")), threadId);
  }
}
