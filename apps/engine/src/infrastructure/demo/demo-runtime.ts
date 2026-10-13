import { startScenario } from "@gravita/adapter-fake";
import { type GravitaEvent, keys, type Provider } from "@gravita/protocol";
import type { Clock } from "../../application/ports/clock";
import type { ProjectionReader } from "../../application/ports/projection-reader";
import type {
  PermissionDecision,
  SessionRuntime,
  SessionRuntimeRegistry,
} from "../../application/ports/session-runtime";
import type { IngestEvents } from "../../application/usecases/ingest-events";
import { NotControllableError } from "../../domain/errors";
import { isPermissionPending } from "../../domain/permissions";

export interface DemoRuntimeOptions {
  /** Seed of the demo story. */
  seed: number;
  ingest: IngestEvents;
  runtimes: SessionRuntimeRegistry;
  sessions: ProjectionReader;
  clock: Clock;
}

/**
 * Plays the scripted demo. Demo sessions behave like ones Gravita runs: each one is
 * registered as a controllable runtime while it lasts, so the user can answer its prompts.
 */
export class DemoRuntime {
  private stopScenario: (() => void) | undefined;

  constructor(private readonly o: DemoRuntimeOptions) {}

  start() {
    this.stopScenario = startScenario({ seed: this.o.seed }, (e) => this.play(e));
  }

  stop() {
    this.stopScenario?.();
    this.stopScenario = undefined;
  }

  /** Ingests one scripted event and keeps the registry in step with the session's life. */
  play(e: GravitaEvent) {
    this.o.ingest.execute([e]);
    if (!e.sessionId) return;
    if (e.type === "session.started") {
      this.o.runtimes.register(new DemoSession(e.sessionId, e.projectId, e.provider, this.o));
    } else if (e.type === "session.ended") {
      this.o.runtimes.unregister(e.sessionId);
    }
  }
}

/** One demo session as a runtime: answers the permission requests it is waiting on. */
class DemoSession implements SessionRuntime {
  constructor(
    readonly sessionId: string,
    readonly projectId: string,
    readonly provider: Provider,
    private readonly o: DemoRuntimeOptions,
  ) {}

  async respondPermission(agentId: string, requestId: string, decision: PermissionDecision) {
    const session = this.o.sessions.session(this.sessionId);
    if (!session || !isPermissionPending(session, agentId, requestId)) {
      throw new NotControllableError(this.sessionId);
    }
    // The scripted auto-answer later carries the same key, so the user's answer wins.
    this.o.ingest.execute([
      {
        key: keys.permissionResolved(requestId),
        ts: this.o.clock.iso(),
        source: "gravita",
        provider: "claude",
        projectId: session.projectId,
        sessionId: this.sessionId,
        agentId,
        type: "permission.resolved",
        data: { requestId, decision, by: "user" },
      },
    ]);
  }

  /** Nothing to release: the scenario owns the playback. */
  async dispose() {}
}
