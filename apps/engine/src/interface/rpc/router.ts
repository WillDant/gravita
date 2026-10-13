import { RpcContract, RpcErrors, type RpcMethod, type RpcResult } from "@gravita/protocol";
import type { z } from "zod";
import type { Logger } from "../../application/ports/logger";
import type { AnswerQuestion } from "../../application/usecases/answer-question";
import type { GetConversation } from "../../application/usecases/get-conversation";
import type { GetEngineStatus } from "../../application/usecases/get-engine-status";
import type { GetSessionEvents } from "../../application/usecases/get-session-events";
import type { GetSnapshot } from "../../application/usecases/get-snapshot";
import type { InterruptSession } from "../../application/usecases/interrupt-session";
import type { ListModels } from "../../application/usecases/list-models";
import type { RespondToPermission } from "../../application/usecases/respond-to-permission";
import type { SendMessage } from "../../application/usecases/send-message";
import type { SetModel } from "../../application/usecases/set-model";
import type { SetPermissionMode } from "../../application/usecases/set-permission-mode";
import type { StartChat } from "../../application/usecases/start-chat";
import type { StopAgent } from "../../application/usecases/stop-agent";
import type { StopAllSessions } from "../../application/usecases/stop-all-sessions";
import {
  BypassLockedError,
  ClaudeUnavailableError,
  DirtyWorktreeError,
  GhUnavailableError,
  InvalidAnswerError,
  InvalidCwdError,
  InvalidSquadPlanError,
  NotARepositoryError,
  NotControllableError,
  NotLoggedInError,
  SquadsUnavailableError,
  SquadWorkspaceError,
  TooManySessionsError,
} from "../../domain/errors";

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
  /** Absent in demo mode: there is no Claude Code to start. */
  startChat?: StartChat;
  sendMessage: SendMessage;
  interruptSession: InterruptSession;
  stopAgent: StopAgent;
  setModel: SetModel;
  setPermissionMode: SetPermissionMode;
  answerQuestion: AnswerQuestion;
  getConversation: GetConversation;
  listModels: ListModels;
  stopAll: StopAllSessions;
}

// M2c: the squad methods are in the contract before the engine runs squads. Until the
// orchestration lands, each one answers SquadsUnavailableError (RpcErrors.squadPhase).
const squadsLater = (): never => {
  throw new SquadsUnavailableError();
};

export function rpcHandlers(d: RouterDeps): RpcHandlers {
  return {
    "state.snapshot": () => d.getSnapshot.execute(),
    "engine.status": () => d.getEngineStatus.execute(),
    "session.events": (p) => d.getSessionEvents.execute(p.sessionId),
    "permission.respond": (p) => d.respondToPermission.execute(p),
    "session.start": (p) => {
      if (!d.startChat) throw new ClaudeUnavailableError("not-found");
      return d.startChat.execute(p);
    },
    "session.send": (p) => d.sendMessage.execute(p),
    "session.interrupt": (p) => d.interruptSession.execute(p),
    "agent.stop": (p) => d.stopAgent.execute(p),
    "session.setModel": (p) => d.setModel.execute(p),
    "session.setPermissionMode": (p) => d.setPermissionMode.execute(p),
    "question.answer": (p) => d.answerQuestion.execute(p),
    "session.conversation": (p) => d.getConversation.execute(p),
    "claude.models": () => d.listModels.execute(),
    "engine.stopAll": () => d.stopAll.execute(),
    "squad.create": squadsLater,
    "squad.replan": squadsLater,
    "squad.approvePlan": squadsLater,
    "squad.pause": squadsLater,
    "squad.resume": squadsLater,
    "squad.stop": squadsLater,
    "squad.task.retry": squadsLater,
    "squad.task.skip": squadsLater,
    "squad.task.reassign": squadsLater,
    "squad.deliver": squadsLater,
  };
}

const isRouted = (handlers: RpcHandlers, method: string): method is RoutedMethod =>
  Object.hasOwn(handlers, method);

/** Maps a failure of a use case to the error the client sees. */
export function toRpcError(err: unknown, logger: Logger, method: string): RpcError {
  if (err instanceof NotControllableError) return RpcErrors.notControllable;
  if (err instanceof ClaudeUnavailableError) return RpcErrors.claudeUnavailable;
  if (err instanceof InvalidCwdError) return RpcErrors.invalidCwd;
  if (err instanceof TooManySessionsError) return RpcErrors.tooManySessions;
  if (err instanceof NotLoggedInError) return RpcErrors.notLoggedIn;
  if (err instanceof InvalidAnswerError) return RpcErrors.badRequest;
  if (err instanceof SquadsUnavailableError)
    return { code: RpcErrors.squadPhase.code, message: err.message };
  // Squad workspace errors keep their message: it says what the user should do.
  if (err instanceof DirtyWorktreeError) return RpcErrors.dirtyWorktree;
  if (err instanceof GhUnavailableError)
    return { code: RpcErrors.ghUnavailable.code, message: err.message };
  if (err instanceof NotARepositoryError)
    return { code: RpcErrors.invalidCwd.code, message: err.message };
  if (err instanceof InvalidSquadPlanError)
    return { code: RpcErrors.invalidPlan.code, message: err.message };
  if (err instanceof SquadWorkspaceError)
    return { code: RpcErrors.squadPhase.code, message: err.message };
  if (err instanceof BypassLockedError)
    return { code: RpcErrors.badRequest.code, message: err.message };
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
