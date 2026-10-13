import { RpcContract, RpcErrors, type RpcMethod, type RpcResult } from "@gravita/protocol";
import type { z } from "zod";
import type { Logger } from "../../application/ports/logger";
import type { GetEngineStatus } from "../../application/usecases/get-engine-status";
import type { GetSessionEvents } from "../../application/usecases/get-session-events";
import type { GetSnapshot } from "../../application/usecases/get-snapshot";
import type { RespondToPermission } from "../../application/usecases/respond-to-permission";
import { NotControllableError } from "../../domain/errors";

// Method → use case, with params validated by the protocol's RpcContract. Pure dispatch:
// no sockets, so it is tested without a network. `auth` is the transport's handshake.

export type RoutedMethod = Exclude<RpcMethod, "auth">;

type ParsedParams<M extends RoutedMethod> = z.output<(typeof RpcContract)[M]["params"]>;

export type RpcHandlers = {
  [M in RoutedMethod]: (params: ParsedParams<M>) => RpcResult<M> | Promise<RpcResult<M>>;
};

export interface RpcError {
  code: number;
  message: string;
}

export type RpcOutcome = { result: unknown } | { error: RpcError };

export const INTERNAL_ERROR: RpcError = { code: -32603, message: "Internal error" };

export interface RpcRouter {
  dispatch(method: string, params: unknown): Promise<RpcOutcome>;
}

export interface RouterDeps {
  getSnapshot: GetSnapshot;
  getEngineStatus: GetEngineStatus;
  getSessionEvents: GetSessionEvents;
  respondToPermission: RespondToPermission;
}

export function rpcHandlers(d: RouterDeps): RpcHandlers {
  return {
    "state.snapshot": () => d.getSnapshot.execute(),
    "engine.status": () => d.getEngineStatus.execute(),
    "session.events": (p) => d.getSessionEvents.execute(p.sessionId),
    "permission.respond": (p) => d.respondToPermission.execute(p),
  };
}

const isRouted = (handlers: RpcHandlers, method: string): method is RoutedMethod =>
  Object.hasOwn(handlers, method);

/** Maps a failure of a use case to the error the client sees. */
function toRpcError(err: unknown, logger: Logger, method: string): RpcError {
  if (err instanceof NotControllableError) return RpcErrors.notControllable;
  logger.log(`${method} failed`, err);
  return INTERNAL_ERROR;
}

export function createRouter(handlers: RpcHandlers, logger: Logger): RpcRouter {
  return {
    async dispatch(method, params) {
      if (!isRouted(handlers, method)) return { error: RpcErrors.methodNotFound };
      const parsed = RpcContract[method].params.safeParse(params);
      if (!parsed.success) return { error: RpcErrors.badRequest };
      const handler = handlers[method] as (p: unknown) => unknown;
      try {
        return { result: await handler(parsed.data) };
      } catch (err) {
        return { error: toRpcError(err, logger, method) };
      }
    },
  };
}
