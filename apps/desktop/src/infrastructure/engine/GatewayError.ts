import { AGENT_PROVIDERS, type AgentProvider, RpcErrors } from "@gravita/protocol/constants";

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
  /** The JSON-RPC error's `data`, when the engine sent some. */
  readonly data: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "GatewayError";
    this.code = code;
    this.data = data;
  }

  /**
   * The provider a provider error is about (`data.provider`); Claude Code when the engine
   * didn't say (engines from before Codex support only ran Claude Code).
   */
  get provider(): AgentProvider {
    const p = (this.data as { provider?: unknown } | undefined)?.provider;
    return AGENT_PROVIDERS.find((known) => known === p) ?? "claude";
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
  providerUnavailable: RpcErrors.providerUnavailable.code,
  invalidCwd: RpcErrors.invalidCwd.code,
  tooManySessions: RpcErrors.tooManySessions.code,
  notLoggedIn: RpcErrors.notLoggedIn.code,
  squadNotFound: RpcErrors.squadNotFound.code,
  planUsageUnavailable: RpcErrors.planUsageUnavailable.code,
  invalidPlan: RpcErrors.invalidPlan.code,
  squadPhase: RpcErrors.squadPhase.code,
  dirtyWorktree: RpcErrors.dirtyWorktree.code,
  ghUnavailable: RpcErrors.ghUnavailable.code,
  codexProfileSignedOut: RpcErrors.codexProfileSignedOut.code,
  terminalUnsupported: RpcErrors.terminalUnsupported.code,
  tooManyTerminals: RpcErrors.tooManyTerminals.code,
  terminalNotFound: RpcErrors.terminalNotFound.code,
} as const;
