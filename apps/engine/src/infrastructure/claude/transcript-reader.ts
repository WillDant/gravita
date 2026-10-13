import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  conversationOf,
  nodeTranscriptFs,
  parseLines,
  type TranscriptFs,
} from "@gravita/adapter-claude";
import type { ConversationMessage } from "@gravita/protocol";
import type { TranscriptReader } from "../../application/ports/transcript-reader";

// Reads a session's main transcript (<claudeHome>/projects/*/<session>.jsonl), read-only,
// to give the Conversation lens full message text. Never follows symlinks out of the tree.

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ClaudeTranscriptReaderOptions {
  claudeHome: string;
  fs?: TranscriptFs;
}

export class ClaudeTranscriptReader implements TranscriptReader {
  constructor(private readonly o: ClaudeTranscriptReaderOptions) {}

  async conversation(sessionId: string): Promise<ConversationMessage[]> {
    const path = await this.locate(sessionId);
    if (!path) return [];
    const text = await (this.o.fs ?? nodeTranscriptFs).readText(path).catch(() => "");
    return conversationOf(parseLines(text));
  }

  /** The main transcript of a session, or null. The id is validated: it becomes a file name. */
  async locate(sessionId: string): Promise<string | null> {
    if (!SESSION_ID.test(sessionId)) return null;
    const root = join(this.o.claudeHome, "projects");
    let dirs: Dirent[];
    try {
      dirs = await readdir(root, { withFileTypes: true });
    } catch {
      return null;
    }
    const name = `${sessionId}.jsonl`;
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      let entries: Dirent[];
      try {
        entries = await readdir(join(root, d.name), { withFileTypes: true });
      } catch {
        continue;
      }
      if (entries.some((f) => f.isFile() && f.name === name)) return join(root, d.name, name);
    }
    return null;
  }
}

/** Demo mode never reads the user's transcripts. */
export const noTranscripts: TranscriptReader = {
  conversation: async () => [],
};
