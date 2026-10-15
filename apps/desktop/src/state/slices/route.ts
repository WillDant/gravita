import type { Slice } from "../store";

export type Route =
  /** `newSession` lands on Home with the new-session panel already open. */
  | { level: "home"; newSession?: true }
  | { level: "settings" }
  /** The terminals split on one screen; `terminalId` puts that one in view and focuses it. */
  | { level: "terminals"; terminalId?: string }
  | { level: "project"; projectId: string }
  | { level: "session"; projectId: string; sessionId: string; agentId?: string }
  /** A terminal not (yet) running a session; once one starts in it, its session's screen. */
  | { level: "terminal"; projectId: string; terminalId: string }
  /** A squad's screen; `taskId` opens one task's panel. */
  | { level: "squad"; projectId: string; squadId: string; taskId?: string }
  /** Dev builds only: the persona gallery (#/gallery), or a squad fixture (#/gallery/squad/run). */
  | { level: "gallery"; squad?: string };

export interface RouteSlice {
  route: Route;
  /** Called by the router; opening a session also loads its events for the line map. */
  setRoute: (route: Route) => void;
}

export const createRouteSlice =
  (route: Route): Slice<RouteSlice> =>
  () =>
  (set, get) => ({
    route,
    setRoute: (next) => {
      set({ route: next });
      if (next.level === "session") get().loadSession(next.sessionId);
    },
  });
