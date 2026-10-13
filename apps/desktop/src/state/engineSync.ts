import type { EngineGateway } from "@/infrastructure/engine/EngineGateway";
import type { AppStore } from "./store";

/** Feeds the store from the gateway's pushes. Returns the unsubscribe. */
export function syncWithEngine(store: AppStore, gateway: EngineGateway): () => void {
  const offs = [
    gateway.onConnection((c) => {
      if (c === "online") void store.getState().syncSnapshot();
      else store.getState().setConnection("offline");
    }),
    gateway.onEvents((batch) => store.getState().applyBatch(batch)),
    gateway.onStatus((status) => store.getState().setEngineStatus(status)),
  ];
  return () => {
    for (const off of offs) off();
  };
}
