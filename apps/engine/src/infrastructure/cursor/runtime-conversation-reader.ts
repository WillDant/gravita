import type { ConversationMessage } from "@gravita/protocol";
import type { SessionRuntimeRegistry } from "../../application/ports/session-runtime";
import type { TranscriptReader } from "../../application/ports/transcript-reader";
import { CURSOR } from "./provider";

/** Full conversation text for live Cursor chats (in-memory on the runtime; empty after dispose). */
export class RuntimeConversationReader implements TranscriptReader {
  constructor(private readonly runtimes: SessionRuntimeRegistry) {}

  conversation(sessionId: string): Promise<ConversationMessage[]> {
    const runtime = this.runtimes.get(sessionId);
    if (runtime?.provider !== CURSOR || !runtime.conversation) return Promise.resolve([]);
    return Promise.resolve([...runtime.conversation()]);
  }
}
