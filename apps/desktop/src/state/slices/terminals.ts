import type { RpcParams, TerminalInfo, TerminalUpdate } from "@gravita/protocol";
import type { Slice } from "../store";
import { attempt, type CommandResult, done } from "./control";

export interface TerminalsSlice {
  /** The engine's open terminals by id (what they print never comes through the store). */
  terminals: Record<string, TerminalInfo>;
  /** Fetches the list again (on every (re)connect). */
  loadTerminals: () => void;
  applyTerminalUpdate: (update: TerminalUpdate) => void;
  spawnTerminal: (params: RpcParams<"terminal.spawn">) => Promise<CommandResult<TerminalInfo>>;
  /** Ends the terminal's process, if it runs, and closes it. */
  killTerminal: (terminalId: string) => Promise<CommandResult>;
}

export const createTerminalsSlice: Slice<TerminalsSlice> = (gateway) => (set, get) => {
  const put = (t: TerminalInfo) => set({ terminals: { ...get().terminals, [t.terminalId]: t } });
  return {
    terminals: {},
    loadTerminals: () => {
      gateway.listTerminals().then(
        ({ terminals }) =>
          set({ terminals: Object.fromEntries(terminals.map((t) => [t.terminalId, t])) }),
        () => {},
      );
    },
    applyTerminalUpdate: (update) => {
      if ("terminal" in update) {
        put(update.terminal);
        return;
      }
      const { [update.closed]: _gone, ...rest } = get().terminals;
      set({ terminals: rest });
    },
    spawnTerminal: async (params) => {
      const r = await attempt(() => gateway.spawnTerminal(params));
      if (r.ok) put(r.value);
      return r;
    },
    killTerminal: async (terminalId) => {
      const r = await done(() => gateway.killTerminal({ terminalId }));
      if (r.ok) get().applyTerminalUpdate({ closed: terminalId });
      return r;
    },
  };
};
