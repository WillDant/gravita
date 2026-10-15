import { emptyState, type GravitaState } from "@gravita/core";
import type { EventsNotification, RpcParams } from "@gravita/protocol";
import type { EngineSnapshot } from "@/infrastructure/engine/EngineGateway";
import { applyEvents } from "../applyEvents";
import type { Slice } from "../store";

export interface ProjectionSlice {
  /** The engine's projection, kept in sync by snapshot + event batches. */
  projection: GravitaState;
  /** Fetches a full snapshot (on every (re)connect); a failure drops the link to retry. */
  syncSnapshot: () => Promise<void>;
  loadSnapshot: (snapshot: EngineSnapshot) => void;
  applyBatch: (batch: EventsNotification) => void;
  respondPermission: (params: RpcParams<"permission.respond">) => Promise<void>;
}

export const createProjectionSlice: Slice<ProjectionSlice> = (gateway) => (set, get) => ({
  projection: emptyState(),
  syncSnapshot: async () => {
    let snapshot: EngineSnapshot;
    try {
      snapshot = await gateway.snapshot();
    } catch {
      gateway.reconnect();
      return;
    }
    get().loadSnapshot(snapshot);
  },
  loadSnapshot: (snapshot) => {
    set({ connection: "online", projection: snapshot.state });
    get().reloadSession();
    get().refreshConversation();
  },
  applyBatch: (batch) => {
    const prev = get().projection;
    const next = applyEvents(prev, batch.events);
    if (next !== prev) {
      next.seq = Math.max(next.seq, batch.seq);
      set({ projection: next });
    }
    get().appendLive(batch.events);
    get().noteConversationEvents(batch.events);
    if (
      batch.events.some(
        (e) => e.type === "session.started" && e.provider === "cursor" && e.data.kind !== "external",
      )
    ) {
      get().reloadModels("cursor");
    }
  },
  respondPermission: async (params) => {
    await gateway.respondPermission(params);
  },
});
