import { keys, type PermissionMode, type Provider } from "@gravita/protocol";
import type { Clock } from "../ports/clock";
import type { IngestEvents } from "../usecases/ingest-events";

export interface SettingsTarget {
  sessionId: string;
  projectId: string;
  provider: Provider;
}

/**
 * Records a Gravita-run session's model and permission mode as `session.settings` events.
 * Each record gets a fresh, increasing sequence (never below the clock), so two changes in
 * the same millisecond, or after a restart, never collide on the idempotency key.
 */
export class SessionSettingsRecorder {
  private last = 0;

  constructor(
    private readonly ingest: IngestEvents,
    private readonly clock: Clock,
  ) {}

  record(t: SettingsTarget, settings: { model?: string; permissionMode?: PermissionMode }) {
    const seq = Math.max(this.last + 1, this.clock.now());
    this.last = seq;
    this.ingest.execute([
      {
        key: keys.sessionSettings(t.sessionId, seq),
        ts: this.clock.iso(),
        source: "gravita",
        provider: t.provider,
        projectId: t.projectId,
        sessionId: t.sessionId,
        type: "session.settings",
        data: {
          ...(settings.model !== undefined ? { model: settings.model } : {}),
          ...(settings.permissionMode !== undefined
            ? { permissionMode: settings.permissionMode }
            : {}),
        },
      },
    ]);
  }
}
