import type { GravitaEvent } from "@gravita/protocol";
import type { Clock } from "../ports/clock";
import type { SessionRuntime, SessionRuntimeRegistry } from "../ports/session-runtime";
import type { IngestEvents } from "../usecases/ingest-events";

/** Runtimes in memory; each change is announced as an ephemeral `session.control`. */
export class InMemorySessionRuntimeRegistry implements SessionRuntimeRegistry {
  private readonly runtimes = new Map<string, SessionRuntime>();

  constructor(
    private readonly ingest: IngestEvents,
    private readonly clock: Clock,
  ) {}

  register(runtime: SessionRuntime) {
    this.runtimes.set(runtime.sessionId, runtime);
    this.ingest.execute([this.controlEvent(runtime, true)]);
  }

  unregister(sessionId: string, only?: SessionRuntime) {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime || (only && runtime !== only)) return;
    this.runtimes.delete(sessionId);
    this.ingest.execute([this.controlEvent(runtime, false)]);
  }

  get(sessionId: string): SessionRuntime | undefined {
    return this.runtimes.get(sessionId);
  }

  all(): SessionRuntime[] {
    return [...this.runtimes.values()];
  }

  isOwned(sessionId: string): boolean {
    return this.runtimes.has(sessionId);
  }

  private controlEvent(r: SessionRuntime, controllable: boolean): GravitaEvent {
    const now = this.clock.now();
    return {
      key: `control:${r.sessionId}:${controllable}:${now}`,
      ts: new Date(now).toISOString(),
      source: "gravita",
      provider: r.provider,
      projectId: r.projectId,
      sessionId: r.sessionId,
      type: "session.control",
      data: { controllable },
    };
  }
}
