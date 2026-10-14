import { CodexSessionTail, type CodexTailCheckpoint, type RolloutFs } from "@gravita/adapter-codex";
import type { GravitaEvent } from "@gravita/protocol";
import type { Clock } from "../../application/ports/clock";
import type { Logger } from "../../application/ports/logger";
import type {
  FoundSession,
  SessionHead,
  SessionSource,
  SessionTailReader,
} from "../../application/ports/session-source";
import type { CodexPresence } from "./codex-presence";
import type { CodexFoundSession, CodexSessionDiscovery } from "./codex-session-discovery";

// Codex's rollouts as a session source: one tail per root thread, which takes in its
// subagents' rollouts as discovery finds them, and tells presence what each poll saw.

/** Plan usage read from an old rollout says nothing about the account now. */
export const FRESH_USAGE_MS = 15 * 60_000;

function parseCheckpoint(json: string): CodexTailCheckpoint | undefined {
  try {
    const cp = JSON.parse(json) as CodexTailCheckpoint;
    return cp && typeof cp === "object" && cp.threads && typeof cp.threads === "object"
      ? cp
      : undefined;
  } catch {
    return undefined;
  }
}

export interface CodexSessionSourceOptions {
  discovery: CodexSessionDiscovery;
  presence: CodexPresence;
  clock: Clock;
  logger: Logger;
  /** How rollouts are read (tests audit it). */
  fs?: RolloutFs;
}

export class CodexSessionSource implements SessionSource {
  readonly name = "codex";
  private readonly tails = new Map<string, CodexSessionTail>();
  private readonly found = new Map<string, CodexFoundSession>();

  constructor(private readonly o: CodexSessionSourceOptions) {}

  async scan(isKnown: (sessionId: string) => boolean): Promise<FoundSession[]> {
    const found = await this.o.discovery.scan(isKnown);
    for (const f of found) {
      this.found.set(f.sessionId, f);
      // New subagents of a session being read join its tail.
      this.tails.get(f.sessionId)?.addThreads(f.files.subagents);
    }
    return found;
  }

  async head(found: FoundSession): Promise<SessionHead | null> {
    const meta = this.found.get(found.sessionId)?.files.root.meta;
    return meta?.cwd ? { cwd: meta.cwd, ts: meta.ts ?? "" } : null;
  }

  resumable(checkpoint: string): boolean {
    return parseCheckpoint(checkpoint) !== undefined;
  }

  open(found: FoundSession, o: { projectId: string; checkpoint?: string }): SessionTailReader {
    const files = this.found.get(found.sessionId)?.files;
    if (!files) throw new Error(`unknown Codex session ${found.sessionId}`);
    const checkpoint = o.checkpoint ? parseCheckpoint(o.checkpoint) : undefined;
    const tail = new CodexSessionTail(files.root, {
      projectId: o.projectId,
      now: () => this.o.clock.now(),
      ...(checkpoint ? { checkpoint } : {}),
      ...(this.o.fs ? { fs: this.o.fs } : {}),
      onSkip: (path, reason) => this.o.logger.log(`skipped ${path}: ${reason}`),
    });
    tail.addThreads(files.subagents);
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
        return this.withoutStaleUsage(events);
      },
      checkpoint: () => JSON.stringify(tail.checkpoint()),
    };
  }

  isLive(sessionId: string): boolean {
    return this.o.presence.isLive(sessionId);
  }

  private withoutStaleUsage(events: GravitaEvent[]): GravitaEvent[] {
    const now = this.o.clock.now();
    return events.filter(
      (e) => e.type !== "usage.limits" || now - (Date.parse(e.ts) || 0) < FRESH_USAGE_MS,
    );
  }
}
