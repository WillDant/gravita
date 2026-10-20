import type { SessionState } from "@gravita/core";

// How full a session's context window is, from its latest reply (any provider).

const DEFAULT_WINDOW = 200_000;
const LONG_WINDOW = 1_000_000;

/** Above this share the meter warns; above `CONTEXT_FULL` it says the window is nearly full. */
export const CONTEXT_WARN = 80;
export const CONTEXT_FULL = 95;

/** The window the session's tokens are measured against: the provider's, else the model's. */
export function contextWindow(session: SessionState): number {
  const c = session.context;
  if (c?.window) return c.window;
  const model = c?.model ?? session.model ?? "";
  if (/\[1m\]|-1m\b/i.test(model)) return LONG_WINDOW;
  // Already past 200K: the window can't be that one.
  return (c?.tokens ?? 0) > DEFAULT_WINDOW ? LONG_WINDOW : DEFAULT_WINDOW;
}

export interface ContextView {
  tokens: number;
  window: number;
  /** 0–100, rounded; may pass 100 right before a compaction. */
  percent: number;
}

export function contextView(session: SessionState): ContextView | undefined {
  const c = session.context;
  if (!c) return undefined;
  const window = contextWindow(session);
  return { tokens: c.tokens, window, percent: Math.round((c.tokens / window) * 100) };
}

export type ContextLevel = "ok" | "warn" | "full";

export const contextLevel = (percent: number): ContextLevel =>
  percent >= CONTEXT_FULL ? "full" : percent >= CONTEXT_WARN ? "warn" : "ok";
