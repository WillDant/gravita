import type { Slice } from "../store";

/** The command palette (⌘K): open from the shortcut or from the menu. */
export interface PaletteSlice {
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
}

export const createPaletteSlice: Slice<PaletteSlice> = () => (set) => ({
  paletteOpen: false,
  setPaletteOpen: (open) => set({ paletteOpen: open }),
});
