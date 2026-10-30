import { useEffect } from "react";
import { useAppStore } from "@/state/hooks";

/** ⌘K (Ctrl+K elsewhere), with no other modifier. */
export const isPaletteChord = (e: KeyboardEvent): boolean =>
  (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k";

/**
 * Opens and closes the palette with ⌘K anywhere in the window. It listens in the capture
 * phase so the terminal and the file editor, which take keys for themselves, never swallow it.
 */
export function useCommandPaletteHotkey() {
  const open = useAppStore((s) => s.paletteOpen);
  const setOpen = useAppStore((s) => s.setPaletteOpen);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isPaletteChord(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(!open);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, setOpen]);
}
