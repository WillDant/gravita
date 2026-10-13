import type { EngineStatus } from "@gravita/protocol";
import type { Slice } from "../store";

export type Connection = "connecting" | "online" | "offline";

export interface ConnectionSlice {
  connection: Connection;
  engineStatus?: EngineStatus;
  setConnection: (connection: Connection) => void;
  setEngineStatus: (status: EngineStatus) => void;
}

export const createConnectionSlice: Slice<ConnectionSlice> = () => (set) => ({
  connection: "connecting",
  setConnection: (connection) => set({ connection }),
  setEngineStatus: (engineStatus) => set({ engineStatus }),
});
