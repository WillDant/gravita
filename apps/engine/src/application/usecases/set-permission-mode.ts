import { isModeOf } from "@gravita/core";
import type { SessionMode } from "@gravita/protocol";
import { modesOf } from "../../domain/chat-policy";
import { InvalidSessionModeError } from "../../domain/errors";
import type { SessionRuntimeRegistry } from "../ports/session-runtime";
import type { SessionSettingsRecorder } from "../services/session-settings";
import { requireRuntime } from "./require-runtime";

/** Switches how a session Gravita runs asks for permissions, in its provider's own modes. */
export class SetPermissionMode {
  constructor(
    private readonly runtimes: SessionRuntimeRegistry,
    private readonly settings: SessionSettingsRecorder,
  ) {}

  async execute(p: { sessionId: string; mode: SessionMode }): Promise<{ ok: true }> {
    const runtime = requireRuntime(this.runtimes, p.sessionId);
    const provider = modesOf(runtime.provider);
    if (!isModeOf(provider, p.mode)) throw new InvalidSessionModeError(provider, p.mode);
    await runtime.setPermissionMode(p.mode);
    this.settings.record(runtime, { permissionMode: p.mode });
    return { ok: true };
  }
}
