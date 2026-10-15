import type { RpcParams, RpcResult, SessionMode } from "@gravita/protocol";
import type { AgentProvider } from "@gravita/protocol/constants";
import { type GatewayError, toGatewayError } from "@/infrastructure/engine/GatewayError";
import type { Slice } from "../store";

/** What a command returns to the UI: the value, or the engine's error with its code. */
export type CommandResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; error: GatewayError };

export interface ModelOption {
  value: string;
  displayName: string;
}

export type ModelsStatus = "idle" | "loading" | "ready" | "failed";

export interface ControlSlice {
  /** Models each provider offers, loaded once per provider from `models.list`. */
  models: Partial<Record<AgentProvider, ModelOption[]>>;
  modelsStatus: Partial<Record<AgentProvider, ModelsStatus>>;
  /**
   * Loads a provider's models (Claude Code's by default) unless they're loaded or loading
   * (a failure can retry).
   */
  loadModels: (provider?: AgentProvider) => void;
  /** Refetches models even when the provider was already `ready` (e.g. after Cursor session/new). */
  reloadModels: (provider?: AgentProvider) => void;
  /** The session just started from Gravita, until the projection catches up with it. */
  startingSessionId?: string;
  startSession: (
    params: RpcParams<"session.start">,
  ) => Promise<CommandResult<RpcResult<"session.start">>>;
  sendMessage: (sessionId: string, text: string) => Promise<CommandResult>;
  interrupt: (sessionId: string) => Promise<CommandResult>;
  stopAgent: (sessionId: string, agentId: string) => Promise<CommandResult>;
  setModel: (sessionId: string, model: string) => Promise<CommandResult>;
  /** `mode` in the session's provider's terms: the engine refuses another provider's mode. */
  setPermissionMode: (sessionId: string, mode: SessionMode) => Promise<CommandResult>;
  answerQuestion: (params: RpcParams<"question.answer">) => Promise<CommandResult>;
  removeSession: (sessionId: string, projectId: string) => Promise<CommandResult>;
}

export async function attempt<T>(call: () => Promise<T>): Promise<CommandResult<T>> {
  try {
    return { ok: true, value: await call() };
  } catch (e) {
    return { ok: false, error: toGatewayError(e) };
  }
}

export async function done(call: () => Promise<unknown>): Promise<CommandResult> {
  const r = await attempt(call);
  return r.ok ? { ok: true, value: undefined } : r;
}

export const createControlSlice: Slice<ControlSlice> = (gateway) => (set, get) => ({
  models: {},
  modelsStatus: {},
  loadModels: (provider = "claude") => {
    const status = get().modelsStatus[provider];
    if (status === "loading" || status === "ready") return;
    get().reloadModels(provider);
  },
  reloadModels: (provider = "claude") => {
    const mark = (next: ModelsStatus, models?: ModelOption[]) =>
      set((s) => ({
        modelsStatus: { ...s.modelsStatus, [provider]: next },
        ...(models ? { models: { ...s.models, [provider]: models } } : {}),
      }));
    mark("loading");
    gateway.models({ provider }).then(
      ({ models }) => mark("ready", models),
      () => mark("failed"),
    );
  },
  startSession: async (params) => {
    const r = await attempt(() => gateway.startSession(params));
    if (r.ok) set({ startingSessionId: r.value.sessionId });
    return r;
  },
  sendMessage: async (sessionId, text) => {
    // The conversation shows the message right away; the transcript's copy replaces it.
    get().setPendingMessage({ sessionId, text, ts: new Date(get().now).toISOString() });
    const r = await done(() => gateway.sendMessage({ sessionId, text }));
    if (!r.ok && get().pendingMessage?.text === text) get().setPendingMessage(undefined);
    return r;
  },
  interrupt: (sessionId) => done(() => gateway.interruptSession({ sessionId })),
  stopAgent: (sessionId, agentId) => done(() => gateway.stopAgent({ sessionId, agentId })),
  setModel: (sessionId, model) => done(() => gateway.setModel({ sessionId, model })),
  setPermissionMode: (sessionId, mode) =>
    done(() => gateway.setPermissionMode({ sessionId, mode })),
  answerQuestion: (params) => done(() => gateway.answerQuestion(params)),
  removeSession: async (sessionId, projectId) => {
    const r = await done(() => gateway.removeSession({ sessionId }));
    if (r.ok) {
      const route = get().route;
      if (route.level === "session" && route.sessionId === sessionId) {
        get().setRoute({ level: "project", projectId });
      }
    }
    return r;
  },
});
