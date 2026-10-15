import { CodexPresence, type CodexPresenceOptions } from "../codex/codex-presence";
import { CURSOR } from "./provider";

/**
 * The same inference as Codex's (an open turn is busy, a recently written chat is idle, a
 * quiet one detaches), for the chats `cursor-agent` runs in a terminal: its transcripts are
 * all there is to go by.
 */
export class CursorPresence extends CodexPresence {
  constructor(o: Omit<CodexPresenceOptions, "provider" | "source">) {
    super({ ...o, provider: CURSOR, source: "cursor-transcript" });
  }
}
