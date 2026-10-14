import * as fsp from "node:fs/promises";
import { join } from "node:path";
import type { GravitaEvent } from "@gravita/protocol";
import type { Clock } from "../../application/ports/clock";
import type { Logger } from "../../application/ports/logger";
import type { ProjectionReader } from "../../application/ports/projection-reader";
import type { AnnounceProject } from "../../application/usecases/announce-project";
import type { IngestEvents } from "../../application/usecases/ingest-events";
import { CLAUDE } from "./provider";

// Live presence from <claudeHome>/sessions/<pid>.json. Only files named exactly
// "<digits>.json" are ever opened: never *.key files, credentials or messaging sockets.

export const REGISTRY_FILE = /^\d+\.json$/;

/** The only fs calls the registry makes, injectable so tests can audit them. */
export interface RegistryFs {
  readdir(path: string): Promise<string[]>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
}

type PresenceStatus = "busy" | "idle" | "waiting";

interface Entry {
  pid: number;
  sessionId: string;
  cwd: string;
  status: PresenceStatus;
}

export function mapStatus(status: unknown): PresenceStatus {
  if (status === "busy") return "busy";
  if (typeof status === "string" && /wait|permission|input|blocked/i.test(status)) return "waiting";
  return "idle";
}

function parseEntry(text: string): Entry | null {
  try {
    const r = JSON.parse(text) as Record<string, unknown>;
    if (!Number.isInteger(r.pid) || (r.pid as number) <= 0) return null;
    if (typeof r.sessionId !== "string" || typeof r.cwd !== "string") return null;
    return {
      pid: r.pid as number,
      sessionId: r.sessionId,
      cwd: r.cwd,
      status: mapStatus(r.status),
    };
  } catch {
    return null;
  }
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export interface RegistryOptions {
  claudeHome: string;
  ingest: IngestEvents;
  /** Where an already known session's project comes from. */
  sessions: ProjectionReader;
  projects: AnnounceProject;
  clock: Clock;
  logger: Logger;
  fs?: RegistryFs;
  isAlive?: (pid: number) => boolean;
  intervalMs?: number;
}

export class Registry {
  private readonly live = new Map<
    string,
    { pid: number; status: PresenceStatus; projectId: string }
  >();
  private readonly fs: RegistryFs;
  private readonly isAlive: (pid: number) => boolean;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(private readonly o: RegistryOptions) {
    this.fs = o.fs ?? {
      readdir: (p) => fsp.readdir(p),
      readFile: (p, enc) => fsp.readFile(p, enc),
    };
    this.isAlive = o.isAlive ?? pidAlive;
  }

  readonly isLive = (sessionId: string): boolean => this.live.has(sessionId);

  start() {
    const loop = async () => {
      try {
        await this.scan();
      } catch (err) {
        this.o.logger.log("registry scan failed", err);
      }
      if (!this.stopped) this.timer = setTimeout(loop, this.o.intervalMs ?? 1_000);
    };
    void loop();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  /** Emits ephemeral `session.presence` on change and `session.detached` when a pid goes away. */
  async scan() {
    const dir = join(this.o.claudeHome, "sessions");
    let names: string[] = [];
    try {
      names = await this.fs.readdir(dir);
    } catch {
      // No registry yet.
    }
    const seen = new Map<string, Entry>();
    for (const name of names) {
      if (!REGISTRY_FILE.test(name)) continue;
      const text = await this.fs.readFile(join(dir, name), "utf8").catch(() => null);
      const entry = text ? parseEntry(text) : null;
      if (entry && this.isAlive(entry.pid)) seen.set(entry.sessionId, entry);
    }

    const nowMs = this.o.clock.now();
    const now = new Date(nowMs).toISOString();
    const events: GravitaEvent[] = [];
    for (const [sessionId, e] of seen) {
      const prev = this.live.get(sessionId);
      if (prev && prev.pid === e.pid && prev.status === e.status) continue;
      const projectId =
        prev?.projectId ??
        this.o.sessions.session(sessionId)?.projectId ??
        (await this.o.projects.execute(e.cwd, now)).id;
      this.live.set(sessionId, { pid: e.pid, status: e.status, projectId });
      events.push({
        key: `presence:${sessionId}:${e.pid}:${e.status}:${nowMs}`,
        ts: now,
        source: "registry",
        provider: CLAUDE,
        projectId,
        sessionId,
        type: "session.presence",
        data: { pid: e.pid, status: e.status },
      });
    }
    for (const [sessionId, prev] of this.live) {
      if (seen.has(sessionId)) continue;
      this.live.delete(sessionId);
      events.push({
        key: `detached:${sessionId}:${prev.pid}:${nowMs}`,
        ts: now,
        source: "registry",
        provider: CLAUDE,
        projectId: prev.projectId,
        sessionId,
        type: "session.detached",
        data: { reason: "process-exited" },
      });
    }
    if (events.length) this.o.ingest.execute(events);
  }
}
