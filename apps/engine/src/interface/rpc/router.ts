import {
  DEFAULT_PROVIDER,
  type ProviderErrorData,
  RpcContract,
  RpcErrors,
  type RpcMethod,
  type RpcResult,
} from "@gravita/protocol";
import type { z } from "zod";
import type { Logger } from "../../application/ports/logger";
import type { CodexProfileControl } from "../../application/ports/squad-profile";
import type { CursorKeyStatus } from "../../application/services/cursor-key-status";
import type { PlanUsageMonitor } from "../../application/services/plan-usage-monitor";
import type { TerminalManager } from "../../application/services/terminal-manager";
import type { UpdateControl } from "../../application/services/update-control";
import type { SquadOrchestrator } from "../../application/squad/squad-orchestrator";
import type { AnswerQuestion } from "../../application/usecases/answer-question";
import type { GetConversation } from "../../application/usecases/get-conversation";
import type { GetEngineStatus } from "../../application/usecases/get-engine-status";
import type { GetSessionEvents } from "../../application/usecases/get-session-events";
import type { GetSnapshot } from "../../application/usecases/get-snapshot";
import type { InterruptSession } from "../../application/usecases/interrupt-session";
import type { ListModels } from "../../application/usecases/list-models";
import type { RemoveSession } from "../../application/usecases/remove-session";
import type { RespondToPermission } from "../../application/usecases/respond-to-permission";
import type { SendMessage } from "../../application/usecases/send-message";
import type { SetModel } from "../../application/usecases/set-model";
import type { SetPermissionMode } from "../../application/usecases/set-permission-mode";
import type { SpawnTerminal } from "../../application/usecases/spawn-terminal";
import type { StartChat } from "../../application/usecases/start-chat";
import type { StopAgent } from "../../application/usecases/stop-agent";
import type { StopAllSessions } from "../../application/usecases/stop-all-sessions";
import {
  BypassLockedError,
  DirtyWorktreeError,
  GhUnavailableError,
  InvalidAnswerError,
  InvalidCwdError,
  InvalidSessionModeError,
  InvalidSquadPlanError,
  NotARepositoryError,
  NotControllableError,
  NotLoggedInError,
  PlanUsageUnavailableError,
  ProviderUnavailableError,
  SquadNotFoundError,
  SquadPhaseError,
  SquadProfileError,
  SquadsUnavailableError,
  SquadWorkspaceError,
  TerminalNotFoundError,
  TerminalUnsupportedError,
  TooManySessionsError,
  TooManySquadsError,
  TooManyTerminalsError,
  UpdateUnavailableError,
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
  /** More about the error where its code defines it (`ProviderErrorData` for provider errors). */
  data?: unknown;
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
  /** Absent in demo mode: there is no agent to start. */
  startChat?: StartChat;
  sendMessage: SendMessage;
  interruptSession: InterruptSession;
  removeSession: RemoveSession;
  stopAgent: StopAgent;
  setModel: SetModel;
  setPermissionMode: SetPermissionMode;
  answerQuestion: AnswerQuestion;
  getConversation: GetConversation;
  listModels: ListModels;
  stopAll: StopAllSessions;
  /** Absent in demo mode: the demo plays a scripted squad and runs none. */
  squads?: SquadOrchestrator;
  /** Plan usage reads; absent in demo mode (nothing to read through). */
  usage?: PlanUsageMonitor;
  /** Gravita's Codex profile for squads; absent when Codex can't run here (or the demo). */
  codexProfile?: CodexProfileControl;
  /** Embedded terminals; absent: every terminal method answers that they're unsupported. */
  terminals?: { spawn: SpawnTerminal; manager: TerminalManager };
  /** The state of the Cursor key pasted in Gravita; absent when Cursor can't run here. */
  cursorKey?: CursorKeyStatus;
  /** Looking for and installing updates; absent in the demo and in tests. */
  updates?: UpdateControl;
}

const OK = { ok: true } as const;

export function rpcHandlers(d: RouterDeps): RpcHandlers {
  const squads = (): SquadOrchestrator => {
    if (!d.squads) throw new SquadsUnavailableError();
    return d.squads;
  };
  const codexProfile = (): CodexProfileControl => {
    if (!d.codexProfile) throw new ProviderUnavailableError("codex", "not-found");
    return d.codexProfile;
  };
  const updates = (): UpdateControl => {
    if (!d.updates) throw new UpdateUnavailableError("Updates aren't available here.");
    return d.updates;
  };
  const terminals = () => {
    if (!d.terminals) throw new TerminalUnsupportedError();
    return d.terminals;
  };
  return {
    "state.snapshot": () => d.getSnapshot.execute(),
    "engine.status": () => d.getEngineStatus.execute(),
    "session.events": (p) => d.getSessionEvents.execute(p.sessionId),
    "permission.respond": (p) => d.respondToPermission.execute(p),
    "session.start": (p) => {
      if (!d.startChat)
        throw new ProviderUnavailableError(p.provider ?? DEFAULT_PROVIDER, "not-found");
      return d.startChat.execute(p);
    },
    "session.send": (p) => d.sendMessage.execute(p),
    "session.interrupt": (p) => d.interruptSession.execute(p),
    "session.remove": (p) => d.removeSession.execute(p),
    "agent.stop": (p) => d.stopAgent.execute(p),
    "session.setModel": (p) => d.setModel.execute(p),
    "session.setPermissionMode": (p) => d.setPermissionMode.execute(p),
    "question.answer": (p) => d.answerQuestion.execute(p),
    "session.conversation": (p) => d.getConversation.execute(p),
    "models.list": (p) => d.listModels.execute(p.provider),
    // The alias older clients call: Claude Code's models.
    "claude.models": () => d.listModels.execute("claude"),
    "engine.stopAll": () => d.stopAll.execute(),
    "squad.create": (p) => squads().create(p),
    "squad.plan": (p) => {
      squads().plan(p);
      return OK;
    },
    "squad.replan": async (p) => {
      await squads().replan(p);
      return OK;
    },
    "squad.approvePlan": async (p) => {
      await squads().approvePlan(p);
      return OK;
    },
    "squad.pause": (p) => {
      squads().pause(p);
      return OK;
    },
    "squad.resume": (p) => {
      squads().resume(p);
      return OK;
    },
    "squad.stop": async (p) => {
      await squads().stop(p);
      return OK;
    },
    "squad.task.retry": (p) => {
      squads().retryTask(p);
      return OK;
    },
    "squad.task.skip": (p) => {
      squads().skipTask(p);
      return OK;
    },
    "squad.task.reassign": (p) => {
      squads().reassignTask(p);
      return OK;
    },
    "squad.deliver": (p) => squads().deliver(p),
    // Answers at once: the reading, if a running session can give one, arrives as events.
    "codexProfile.status": () => codexProfile().status(),
    "codexProfile.signIn": () => codexProfile().signIn(),
    "codexProfile.signOut": async () => {
      await codexProfile().signOut();
      return OK;
    },
    // Checks the key the desktop shell handed over; only its state comes back, never the key.
    "cursorKey.validate": () => {
      if (!d.cursorKey) throw new ProviderUnavailableError("cursor", "not-found");
      return d.cursorKey.check();
    },
    "update.check": () => updates().check(),
    "update.install": async () => {
      await updates().install();
      return OK;
    },
    "terminal.spawn": (p) => terminals().spawn.execute(p),
    "terminal.write": (p) => {
      terminals().manager.write(p.terminalId, p.data);
      return OK;
    },
    "terminal.resize": (p) => {
      terminals().manager.resize(p.terminalId, p.cols, p.rows);
      return OK;
    },
    "terminal.kill": async (p) => {
      await terminals().manager.kill(p.terminalId);
      return OK;
    },
    "terminal.list": () => ({ terminals: d.terminals?.manager.list() ?? [] }),
    "terminal.attach": (p) => terminals().manager.attach(p.terminalId),
    "usage.refresh": (p) => {
      void d.usage?.refresh(p?.provider ? { provider: p.provider } : {});
      return OK;
    },
  };
}

const isRouted = (handlers: RpcHandlers, method: string): method is RoutedMethod =>
  Object.hasOwn(handlers, method);

/** A provider error: the neutral code and message, and which provider in `data`. */
const providerError = (base: RpcError, provider: ProviderErrorData["provider"]): RpcError => ({
  ...base,
  data: { provider } satisfies ProviderErrorData,
});

/** Maps a failure of a use case to the error the client sees. */
export function toRpcError(err: unknown, logger: Logger, method: string): RpcError {
  if (err instanceof NotControllableError) return RpcErrors.notControllable;
  if (err instanceof ProviderUnavailableError)
    return providerError(RpcErrors.providerUnavailable, err.provider);
  if (err instanceof InvalidCwdError) return RpcErrors.invalidCwd;
  if (err instanceof TooManySessionsError) return RpcErrors.tooManySessions;
  if (err instanceof NotLoggedInError) return providerError(RpcErrors.notLoggedIn, err.provider);
  if (err instanceof InvalidSessionModeError)
    return { code: RpcErrors.badRequest.code, message: err.message };
  if (err instanceof InvalidAnswerError) return RpcErrors.badRequest;
  if (err instanceof SquadsUnavailableError)
    return { code: RpcErrors.squadPhase.code, message: err.message };
  if (err instanceof SquadNotFoundError) return RpcErrors.squadNotFound;
  if (err instanceof SquadPhaseError)
    return { code: RpcErrors.squadPhase.code, message: err.message };
  if (err instanceof TooManySquadsError)
    return { code: RpcErrors.tooManySessions.code, message: err.message };
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
  if (err instanceof SquadProfileError)
    return providerError(
      { code: RpcErrors.codexProfileSignedOut.code, message: err.message },
      err.provider,
    );
  if (err instanceof UpdateUnavailableError)
    return { code: RpcErrors.badRequest.code, message: err.message };
  if (err instanceof TerminalUnsupportedError) return RpcErrors.terminalUnsupported;
  if (err instanceof TooManyTerminalsError) return RpcErrors.tooManyTerminals;
  if (err instanceof TerminalNotFoundError) return RpcErrors.terminalNotFound;
  if (err instanceof PlanUsageUnavailableError)
    return providerError(
      { code: RpcErrors.planUsageUnavailable.code, message: err.message },
      err.provider,
    );
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
