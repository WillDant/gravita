import { NotControllableError } from "../../domain/errors";
import type { SessionRuntime, SessionRuntimeRegistry } from "../ports/session-runtime";

/** The runtime controlling a session; external sessions have none (their controls live in a terminal). */
export function requireRuntime(
  runtimes: SessionRuntimeRegistry,
  sessionId: string,
): SessionRuntime {
  const runtime = runtimes.get(sessionId);
  if (!runtime) throw new NotControllableError(sessionId);
  return runtime;
}
