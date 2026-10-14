import type { ITheme } from "@xterm/xterm";

/**
 * The terminal is a dark surface in both app themes: the CLIs that run in it (and the
 * colours people configured for them) assume a dark background. Its colours come from the
 * dark tokens and the agent palette, so it still reads as Gravita's.
 */
export const TERMINAL_THEME: ITheme = {
  background: "#0f1115",
  foreground: "#eceef2",
  cursor: "#7f9cff",
  cursorAccent: "#0f1115",
  selectionBackground: "#7f9cff40",
  black: "#1c2029",
  red: "#ff6b5e",
  green: "#3ccb86",
  yellow: "#ffc83d",
  blue: "#5b9bff",
  magenta: "#cc72e6",
  cyan: "#2ec4be",
  white: "#b2b8c3",
  brightBlack: "#646b78",
  brightRed: "#ff8b80",
  brightGreen: "#5fd99d",
  brightYellow: "#ffd56b",
  brightBlue: "#7f9cff",
  brightMagenta: "#d892ee",
  brightCyan: "#4fd8d2",
  brightWhite: "#ffffff",
};

/** What the engine takes in one `terminal.write` (a long paste goes in pieces). */
export const WRITE_CHUNK = 32_000;

/** Splits input for `terminal.write`. */
export function chunks(data: string, size = WRITE_CHUNK): string[] {
  const out: string[] = [];
  for (let at = 0; at < data.length; at += size) out.push(data.slice(at, at + size));
  return out;
}
