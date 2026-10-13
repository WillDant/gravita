import type { SquadState } from "@gravita/core";

/** Read-only queries on the squads in the live projection. Results are copies. */
export interface SquadReader {
  squad(squadId: string): SquadState | undefined;
  squads(): SquadState[];
}
