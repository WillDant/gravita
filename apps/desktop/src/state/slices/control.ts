import type { PermissionMode, RpcParams, RpcResult } from "@gravita/protocol";
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
  /** Models Claude Code offers, loaded once from `claude.models`. */
  models: ModelOption[];
  modelsStatus: ModelsStatus;
  /** Loads the models list unless it's loaded or loading (a failure can retry). */
  loadModels: () => void;
  /** The session just started from Gravita, until the projection catches up with it. */
  startingSessionId?: string;
  startSession: (
    params: RpcParams<"session.start">,
  ) => Promise<CommandResult<RpcResult<"session.start">>>;
  sendMessage: (sessionId: string, text: string) => Promise<CommandResult>;
  interrupt: (sessionId: string) => Promise<CommandResult>;
  stopAgent: (sessionId: string, agentId: string) => Promise<CommandResult>;
  setModel: (sessionId: string, model: string) => Promise<CommandResult>;
  setPermissionMode: (sessionId: string, mode: PermissionMode) => Promise<CommandResult>;
  answerQuestion: (params: RpcParams<"question.answer">) => Promise<CommandResult>;
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
  models: [],
  modelsStatus: "idle",
  loadModels: () => {
    const status = get().modelsStatus;
    if (status === "loading" || status === "ready") return;
    set({ modelsStatus: "loading" });
    gateway.models().then(
      ({ models }) => set({ models, modelsStatus: "ready" }),
      () => set({ modelsStatus: "failed" }),
    );
  },
  startSession: async (params) => {
    const r = await attempt(() => gateway.startSession(params));
    if (r.ok) set({ startingSessionId: r.value.sessionId });
    return r;
  },
  sendMessage: (sessionId, text) => done(() => gateway.sendMessage({ sessionId, text })),
  interrupt: (sessionId) => done(() => gateway.interruptSession({ sessionId })),
  stopAgent: (sessionId, agentId) => done(() => gateway.stopAgent({ sessionId, agentId })),
  setModel: (sessionId, model) => done(() => gateway.setModel({ sessionId, model })),
  setPermissionMode: (sessionId, mode) =>
    done(() => gateway.setPermissionMode({ sessionId, mode })),
  answerQuestion: (params) => done(() => gateway.answerQuestion(params)),
});
