import type { RolloutFs } from "@gravita/adapter-codex";
import { CursorSessionTail, type CursorTailCheckpoint } from "@gravita/adapter-cursor";
import type { Clock } from "../../application/ports/clock";
import type { Logger } from "../../application/ports/logger";
import type {
  FoundSession,
  SessionHead,
  SessionSource,
  SessionTailReader,
} from "../../application/ports/session-source";
import type { CursorPresence } from "./cursor-presence";
import type { CursorFoundSession, CursorSessionDiscovery } from "./cursor-session-discovery";

// The chats `cursor-agent` runs in a terminal as a session source: one tail per chat, which
// takes in the transcripts of its subagents as discovery finds them, and tells presence what
// each poll saw.

function parseCheckpoint(json: string): CursorTailCheckpoint | undefined {
  try {
    const cp = JSON.parse(json) as CursorTailCheckpoint;
    return cp && typeof cp === "object" && cp.v === 1 && cp.files && typeof cp.files === "object"
      ? cp
      : undefined;
  } catch {
    return undefined;
  }
}

export interface CursorSessionSourceOptions {
  discovery: CursorSessionDiscovery;
  presence: CursorPresence;
  clock: Clock;
  logger: Logger;
  /** How transcripts are read (tests audit it). */
  fs?: RolloutFs;
}

export class CursorSessionSource implements SessionSource {
  readonly name = "cursor";
  private readonly tails = new Map<string, CursorSessionTail>();
  private readonly found = new Map<string, CursorFoundSession>();

  constructor(private readonly o: CursorSessionSourceOptions) {}

  async scan(isKnown: (sessionId: string) => boolean): Promise<FoundSession[]> {
    const found = await this.o.discovery.scan(isKnown);
    for (const f of found) {
      this.found.set(f.sessionId, f);
      // New subagents of a chat being read join its tail.
      this.tails.get(f.sessionId)?.addChildren(f.children);
    }
    return found;
  }

  async head(found: FoundSession): Promise<SessionHead | null> {
    const meta = this.found.get(found.sessionId)?.meta;
    return meta ? { cwd: meta.cwd, ts: new Date(meta.createdAtMs).toISOString() } : null;
  }

  resumable(checkpoint: string): boolean {
    return parseCheckpoint(checkpoint) !== undefined;
  }

  open(found: FoundSession, o: { projectId: string; checkpoint?: string }): SessionTailReader {
    const chat = this.found.get(found.sessionId);
    if (!chat) throw new Error(`unknown Cursor session ${found.sessionId}`);
    const checkpoint = o.checkpoint ? parseCheckpoint(o.checkpoint) : undefined;
    const tail = new CursorSessionTail({
      chatId: chat.chatId,
      path: chat.path,
      projectId: o.projectId,
      cwd: chat.meta.cwd,
      startedAt: new Date(chat.meta.createdAtMs).toISOString(),
      ...(chat.meta.title ? { title: chat.meta.title } : {}),
      ...(checkpoint ? { checkpoint } : {}),
      ...(this.o.fs ? { fs: this.o.fs } : {}),
      onSkip: (path, reason) => this.o.logger.log(`skipped ${path}: ${reason}`),
    });
    tail.addChildren(chat.children);
    this.tails.set(found.sessionId, tail);
    return {
      poll: async () => {
        const events = await tail.poll();
        const latest = this.found.get(found.sessionId);
        this.o.presence.observe(
          found.sessionId,
          o.projectId,
          tail.openTurn(),
          latest?.mtimeMs ?? found.mtimeMs,
        );
        return events;
      },
      checkpoint: () => JSON.stringify(tail.checkpoint()),
    };
  }

  isLive(sessionId: string): boolean {
    return this.o.presence.isLive(sessionId);
  }
}
