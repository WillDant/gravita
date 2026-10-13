import { LIVE_WINDOW_MS } from "@gravita/core";

/**
 * Which transcripts to poll fast: a session whose process is alive, or whose file was
 * written within the live window (the same window the UI uses for "now").
 */
export function isHot(t: { mtimeMs: number; live: boolean }, now: number): boolean {
  return t.live || now - t.mtimeMs < LIVE_WINDOW_MS;
}
