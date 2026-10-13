import type { GravitaState } from "@gravita/core";
import { type NotificationIntent, stillRelevant } from "./rules";

/**
 * The deep link of the most recent notification.
 *
 * Why a heuristic: tauri-plugin-notification can't reliably tell the webview which desktop
 * notification was clicked, and a click only activates the app (the shell then shows and
 * focuses the window, on Reopen or from the tray). So we remember where the latest
 * notification points, and when the window is next visible and focused within
 * `LINK_TTL_MS`, we open it, provided it still matters (the agent still waits on you; for
 * a finished or failed turn, the session is still there). Any return to the window
 * consumes it, clicked or not: coming back to Gravita right after it called you is
 * treated as answering the call. Limits: an older notification clicked after a newer one
 * still leads to the newer one, and focusing the window by other means within the window
 * of time also follows the link.
 */
export const LINK_TTL_MS = 2 * 60_000;

export interface PendingLink {
  /** Remembers the latest notification shown (replacing any older one). */
  remember(intent: NotificationIntent, at: number): void;
  /** The route to open on return, if any; always clears the pending link. */
  take(state: GravitaState, now: number): NotificationIntent["route"] | undefined;
}

export function createPendingLink(ttl = LINK_TTL_MS): PendingLink {
  let pending: { intent: NotificationIntent; at: number } | undefined;
  return {
    remember(intent, at) {
      pending = { intent, at };
    },
    take(state, now) {
      const p = pending;
      pending = undefined;
      if (!p || now - p.at > ttl) return undefined;
      return stillRelevant(p.intent, state, now) ? p.intent.route : undefined;
    },
  };
}
