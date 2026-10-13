import type { DeliverMode, RpcParams, RpcResult } from "@gravita/protocol";
import type { Slice } from "../store";
import { attempt, type CommandResult, done } from "./control";

/** Driving squads: every command answers with the value or the engine's error (code kept). */
export interface SquadSlice {
  /** The squad just created from Gravita, until the projection catches up with it. */
  startingSquadId?: string;
  createSquad: (
    params: RpcParams<"squad.create">,
  ) => Promise<CommandResult<RpcResult<"squad.create">>>;
  planSquad: (squadId: string) => Promise<CommandResult>;
  replanSquad: (squadId: string, feedback: string) => Promise<CommandResult>;
  approvePlan: (params: RpcParams<"squad.approvePlan">) => Promise<CommandResult>;
  pauseSquad: (squadId: string) => Promise<CommandResult>;
  resumeSquad: (params: RpcParams<"squad.resume">) => Promise<CommandResult>;
  stopSquad: (squadId: string) => Promise<CommandResult>;
  retryTask: (squadId: string, taskId: string, model?: string) => Promise<CommandResult>;
  skipTask: (squadId: string, taskId: string) => Promise<CommandResult>;
  reassignTask: (squadId: string, taskId: string, role: string) => Promise<CommandResult>;
  deliverSquad: (
    squadId: string,
    mode: DeliverMode,
  ) => Promise<CommandResult<RpcResult<"squad.deliver">>>;
}

export const createSquadSlice: Slice<SquadSlice> = (gateway) => (set) => ({
  createSquad: async (params) => {
    const r = await attempt(() => gateway.createSquad(params));
    if (r.ok) set({ startingSquadId: r.value.squadId });
    return r;
  },
  planSquad: (squadId) => done(() => gateway.planSquad({ squadId })),
  replanSquad: (squadId, feedback) => done(() => gateway.replanSquad({ squadId, feedback })),
  approvePlan: (params) => done(() => gateway.approvePlan(params)),
  pauseSquad: (squadId) => done(() => gateway.pauseSquad({ squadId })),
  resumeSquad: (params) => done(() => gateway.resumeSquad(params)),
  stopSquad: (squadId) => done(() => gateway.stopSquad({ squadId })),
  retryTask: (squadId, taskId, model) =>
    done(() => gateway.retryTask({ squadId, taskId, ...(model ? { model } : {}) })),
  skipTask: (squadId, taskId) => done(() => gateway.skipTask({ squadId, taskId })),
  reassignTask: (squadId, taskId, role) =>
    done(() => gateway.reassignTask({ squadId, taskId, role })),
  deliverSquad: (squadId, mode) => attempt(() => gateway.deliverSquad({ squadId, mode })),
});
