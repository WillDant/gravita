import type { GravitaEvent } from "@gravita/protocol";
import { keys } from "@gravita/protocol/ids";
import type { Clock } from "../ports/clock";
import type { ProjectionReader } from "../ports/projection-reader";
import type { SessionRuntimeRegistry } from "../ports/session-runtime";
import type { IngestEvents } from "./ingest-events";

/** Stops a live runtime if any, then hides the session from lists (`session.removed`). */
export class RemoveSession {
  constructor(
    private readonly runtimes: SessionRuntimeRegistry,
    private readonly projection: ProjectionReader,
    private readonly ingest: IngestEvents,
    private readonly clock: Clock,
  ) {}

  async execute(p: { sessionId: string }): Promise<{ ok: true }> {
    const session = this.projection.session(p.sessionId);
    if (!session || session.removed) return { ok: true };

    const runtime = this.runtimes.get(p.sessionId);
    if (runtime) await runtime.dispose();

    const ts = new Date(this.clock.now()).toISOString();
    const base = {
      ts,
      source: "gravita" as const,
      provider: session.provider as GravitaEvent["provider"],
      projectId: session.projectId,
      sessionId: p.sessionId,
    };
    const events: GravitaEvent[] = [];
    if (!session.ended) {
      events.push({
        ...base,
        key: keys.sessionEnded(p.sessionId),
        type: "session.ended",
        data: { reason: "removed" },
      });
    }
    events.push({
      ...base,
      key: keys.sessionRemoved(p.sessionId),
      type: "session.removed",
      data: { reason: "user" },
    });
    this.ingest.execute(events);
    return { ok: true };
  }
}
