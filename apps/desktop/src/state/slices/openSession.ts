import type { GravitaEvent } from "@gravita/protocol";
import type { Slice } from "../store";

export interface OpenSession {
  id: string;
  events: GravitaEvent[];
  loading: boolean;
}

export interface OpenSessionSlice {
  /** Events of the session currently open (for the line map), kept live. */
  openSession?: OpenSession;
  /** Loads a session's stored events, keeping live ones that arrive meanwhile. */
  loadSession: (sessionId: string) => void;
  /** Drops what is loaded and fetches the routed session again (after a reconnect). */
  reloadSession: () => void;
  /** Appends live events that belong to the open session. */
  appendLive: (events: readonly GravitaEvent[]) => void;
}

/** Stored events first, then live ones the fetch didn't include (same idempotency key). */
export function mergeEvents(
  stored: readonly GravitaEvent[],
  live: readonly GravitaEvent[],
): GravitaEvent[] {
  const keys = new Set(stored.map((e) => e.key));
  return [...stored, ...live.filter((e) => !keys.has(e.key))];
}

export const createOpenSessionSlice: Slice<OpenSessionSlice> = (gateway) => (set, get) => ({
  loadSession: (sessionId) => {
    if (get().openSession?.id === sessionId) return;
    set({ openSession: { id: sessionId, events: [], loading: true } });
    gateway
      .sessionEvents({ sessionId })
      .then(({ events }) => {
        const cur = get().openSession;
        if (cur?.id !== sessionId) return;
        set({
          openSession: { id: sessionId, events: mergeEvents(events, cur.events), loading: false },
        });
      })
      .catch(() => {
        const cur = get().openSession;
        if (cur?.id === sessionId) set({ openSession: { ...cur, loading: false } });
      });
  },
  reloadSession: () => {
    const route = get().route;
    if (route.level !== "session") return;
    set({ openSession: undefined });
    get().loadSession(route.sessionId);
  },
  appendLive: (events) => {
    const open = get().openSession;
    if (!open) return;
    const mine = events.filter((e) => e.sessionId === open.id);
    if (mine.length > 0) set({ openSession: { ...open, events: [...open.events, ...mine] } });
  },
});
