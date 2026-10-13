import { readSessionHead, SessionTail, type TailCheckpoint } from "@gravita/adapter-claude";
import type { Clock } from "../../application/ports/clock";
import type {
  FoundSession,
  SessionHead,
  SessionSource,
  SessionTailReader,
} from "../../application/ports/session-source";
import type { TranscriptDiscovery } from "./transcript-discovery";

// Claude Code's transcripts (<claudeHome>/projects/*/<session>.jsonl) as a session source.

function parseCheckpoint(json: string): TailCheckpoint | undefined {
  try {
    const cp = JSON.parse(json) as TailCheckpoint;
    return cp && typeof cp === "object" && cp.files && typeof cp.files === "object"
      ? cp
      : undefined;
  } catch {
    return undefined;
  }
}

export interface ClaudeSessionSourceOptions {
  discovery: TranscriptDiscovery;
  clock: Clock;
  /** True while the session's process is alive (registry). */
  isLive: (sessionId: string) => boolean;
}

export class ClaudeSessionSource implements SessionSource {
  readonly name = "claude";

  constructor(private readonly o: ClaudeSessionSourceOptions) {}

  scan(isKnown: (sessionId: string) => boolean): Promise<FoundSession[]> {
    return this.o.discovery.scan(isKnown);
  }

  head(found: FoundSession): Promise<SessionHead | null> {
    return readSessionHead(found.path);
  }

  resumable(checkpoint: string): boolean {
    return parseCheckpoint(checkpoint) !== undefined;
  }

  open(found: FoundSession, o: { projectId: string; checkpoint?: string }): SessionTailReader {
    const checkpoint = o.checkpoint ? parseCheckpoint(o.checkpoint) : undefined;
    const tail = new SessionTail(found.path, {
      projectId: o.projectId,
      now: () => this.o.clock.now(),
      ...(checkpoint ? { checkpoint } : {}),
    });
    return { poll: () => tail.poll(), checkpoint: () => JSON.stringify(tail.checkpoint()) };
  }

  isLive(sessionId: string): boolean {
    return this.o.isLive(sessionId);
  }
}
