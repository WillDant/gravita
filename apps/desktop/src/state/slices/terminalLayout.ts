import type { Slice } from "../store";
import {
  hasPane,
  type Layout,
  paneIds,
  parseLayout,
  placeBeside,
  pruneLayout,
  removePane,
  replacePane,
  type SplitDir,
  type SplitPath,
  setRatio,
  splitPane,
} from "../terminalLayout";

const KEY = "gravita.terminals.layout";

export type LayoutStorage = () => Pick<Storage, "getItem" | "setItem"> | undefined;

export const browserStorage: LayoutStorage = () => {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
};

export interface TerminalLayoutSlice {
  /** How the open terminals are split on the Terminais screen. */
  terminalLayout: Layout;
  /** The terminal that has the keyboard there. */
  focusedTerminal: string | undefined;
  focusTerminal: (terminalId: string) => void;
  /** Puts a terminal on the screen if it isn't (beside the focused one) and focuses it. */
  placeTerminal: (terminalId: string) => void;
  splitTerminal: (targetId: string, dir: SplitDir, newId: string) => void;
  replaceTerminal: (from: string, to: string) => void;
  resizeSplit: (path: SplitPath, ratio: number) => void;
  removeFromTerminalLayout: (terminalId: string) => void;
  /** Drops the terminals that are gone. */
  pruneTerminalLayout: (keep: readonly string[]) => void;
}

function load(storage: LayoutStorage): Layout {
  try {
    const raw = storage()?.getItem(KEY);
    return raw ? parseLayout(JSON.parse(raw)) : undefined;
  } catch {
    return undefined;
  }
}

export const createTerminalLayoutSlice =
  (storage: LayoutStorage): Slice<TerminalLayoutSlice> =>
  () =>
  (set, get) => {
    const save = (layout: Layout) => {
      try {
        storage()?.setItem(KEY, JSON.stringify(layout ?? null));
      } catch {}
    };
    /** Sets the tree and keeps the focus on a terminal that is still in it. */
    const apply = (layout: Layout, focus?: string) => {
      const focused = focus ?? get().focusedTerminal;
      set({
        terminalLayout: layout,
        focusedTerminal: focused && hasPane(layout, focused) ? focused : paneIds(layout)[0],
      });
      save(layout);
    };
    return {
      terminalLayout: load(storage),
      focusedTerminal: undefined,
      focusTerminal: (terminalId) => {
        if (hasPane(get().terminalLayout, terminalId)) set({ focusedTerminal: terminalId });
      },
      placeTerminal: (terminalId) =>
        apply(placeBeside(get().terminalLayout, get().focusedTerminal, terminalId), terminalId),
      splitTerminal: (targetId, dir, newId) => {
        const tree = get().terminalLayout;
        if (!tree || !hasPane(tree, targetId)) return;
        apply(splitPane(tree, targetId, dir, newId), newId);
      },
      replaceTerminal: (from, to) => {
        const wasFocused = get().focusedTerminal === from;
        apply(replacePane(get().terminalLayout, from, to), wasFocused ? to : undefined);
      },
      resizeSplit: (path, ratio) => apply(setRatio(get().terminalLayout, path, ratio)),
      removeFromTerminalLayout: (terminalId) => {
        if (hasPane(get().terminalLayout, terminalId))
          apply(removePane(get().terminalLayout, terminalId));
      },
      pruneTerminalLayout: (keep) => {
        const tree = get().terminalLayout;
        const next = pruneLayout(tree, new Set(keep));
        if (next !== tree) apply(next);
      },
    };
  };
