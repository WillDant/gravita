import type { Slice } from "../store";

export type Route =
  | { level: "home" }
  | { level: "project"; projectId: string }
  | { level: "session"; projectId: string; sessionId: string; agentId?: string };

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
