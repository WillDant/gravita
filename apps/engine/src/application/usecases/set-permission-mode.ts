import type { PermissionMode } from "@gravita/protocol";
import type { SessionRuntimeRegistry } from "../ports/session-runtime";
import type { SessionSettingsRecorder } from "../services/session-settings";
import { requireRuntime } from "./require-runtime";

/** Switches how a session Gravita runs asks for permissions. */
export class SetPermissionMode {
  constructor(
    private readonly runtimes: SessionRuntimeRegistry,
    private readonly settings: SessionSettingsRecorder,
  ) {}

  async execute(p: { sessionId: string; mode: PermissionMode }): Promise<{ ok: true }> {
    const runtime = requireRuntime(this.runtimes, p.sessionId);
    await runtime.setPermissionMode(p.mode);
    this.settings.record(runtime, { permissionMode: p.mode });
    return { ok: true };
  }
}
