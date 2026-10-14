import type { GravitaEvent } from "@gravita/protocol";
import type { Clock } from "../ports/clock";
import type {
  OpeningRuntime,
  SessionRuntime,
  SessionRuntimeRegistry,
} from "../ports/session-runtime";
import type { IngestEvents } from "../usecases/ingest-events";

/** Runtimes in memory; each change is announced as an ephemeral `session.control`. */
export class InMemorySessionRuntimeRegistry implements SessionRuntimeRegistry {
  private readonly runtimes = new Map<string, SessionRuntime>();
  private readonly openings = new Map<SessionRuntime, { cancelled: boolean }>();

  constructor(
    private readonly ingest: IngestEvents,
    private readonly clock: Clock,
  ) {}

  opening(runtime: SessionRuntime): OpeningRuntime {
    const state = { cancelled: false };
    this.openings.set(runtime, state);
    return {
      get cancelled() {
        return state.cancelled;
      },
      done: () => {
        if (this.openings.get(runtime) === state) this.openings.delete(runtime);
      },
    };
  }

  cancelOpening(): SessionRuntime[] {
    const cancelled = [...this.openings.keys()];
    for (const state of this.openings.values()) state.cancelled = true;
    this.openings.clear();
    return cancelled;
  }

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
