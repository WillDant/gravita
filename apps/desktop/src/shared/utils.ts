import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

/** "~/projects/app" for paths under the home folder, when we can tell. */
export function tildify(path: string): string {
  return path.replace(/^\/(Users|home)\/[^/]+/, "~");
}

/** The modifier people press for shortcuts here: ⌘ on Apple platforms, Ctrl elsewhere. */
export const MOD_KEY =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl";

/** ⌘↩ or Ctrl↩: the "send" chord of every multi-line field. */
export function isSendChord(e: { key: string; metaKey: boolean; ctrlKey: boolean }): boolean {
  return e.key === "Enter" && (e.metaKey || e.ctrlKey);
}

/**
 * The chat composer's send key: return sends, shift-return breaks the line, and the ⌘↩ chord
 * keeps working. A return that confirms an IME composition never sends.
 */
export function isComposerSend(e: {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  nativeEvent?: { isComposing?: boolean };
}): boolean {
  if (e.key !== "Enter" || e.nativeEvent?.isComposing) return false;
  return !e.shiftKey || e.metaKey || e.ctrlKey;
}
