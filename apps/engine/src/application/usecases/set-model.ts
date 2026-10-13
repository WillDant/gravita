import type { SessionRuntimeRegistry } from "../ports/session-runtime";
import type { SessionSettingsRecorder } from "../services/session-settings";
import { requireRuntime } from "./require-runtime";

/** Switches the model of a session Gravita runs, for its next turns. */
export class SetModel {
  constructor(
    private readonly runtimes: SessionRuntimeRegistry,
    private readonly settings: SessionSettingsRecorder,
  ) {}

  async execute(p: { sessionId: string; model: string }): Promise<{ ok: true }> {
    const runtime = requireRuntime(this.runtimes, p.sessionId);
    await runtime.setModel(p.model);
    this.settings.record(runtime, { model: p.model });
    return { ok: true };
  }
}
