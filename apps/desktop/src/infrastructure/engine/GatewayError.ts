import { RpcErrors } from "@gravita/protocol/constants";

/** Codes for failures that never reached the engine (no JSON-RPC error code exists). */
export const LocalErrors = {
  /** The link is down or dropped before the answer came. */
  offline: -1,
  /** The engine didn't answer in time. */
  timeout: -2,
} as const;

/**
 * A failed engine call, keeping the JSON-RPC error code so the UI can say what went
 * wrong and what to do (see `RpcErrors` in the protocol).
 */
export class GatewayError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = "GatewayError";
    this.code = code;
  }
}

/** Any thrown value as a GatewayError (plain errors become "offline"). */
export function toGatewayError(e: unknown): GatewayError {
  if (e instanceof GatewayError) return e;
  return new GatewayError(LocalErrors.offline, e instanceof Error ? e.message : String(e));
}

/** The error codes the UI explains in its own words; anything else shows a generic line. */
export const KnownErrors = {
  notControllable: RpcErrors.notControllable.code,
  claudeUnavailable: RpcErrors.claudeUnavailable.code,
  invalidCwd: RpcErrors.invalidCwd.code,
  tooManySessions: RpcErrors.tooManySessions.code,
  notLoggedIn: RpcErrors.notLoggedIn.code,
  squadNotFound: RpcErrors.squadNotFound.code,
  invalidPlan: RpcErrors.invalidPlan.code,
  squadPhase: RpcErrors.squadPhase.code,
  dirtyWorktree: RpcErrors.dirtyWorktree.code,
  ghUnavailable: RpcErrors.ghUnavailable.code,
} as const;
