import { apply, emptyState, type GravitaState } from "@gravita/core";
import type { EngineStatus, GravitaEvent } from "@gravita/protocol";
import { create } from "zustand";
import { EngineClient, resolveEndpoint } from "./lib/engine";

export type Route =
  | { level: "home" }
  | { level: "project"; projectId: string }
  | { level: "session"; projectId: string; sessionId: string; agentId?: string };

type Connection = "connecting" | "online" | "offline";

interface Store {
  connection: Connection;
  engineStatus?: EngineStatus;
  state: GravitaState;
  /** Bumped on every applied batch; components select it to re-render. */
  rev: number;
  /** Events of the session currently open (for the line map), kept live. */
  openSession?: { id: string; events: GravitaEvent[]; loading: boolean };
  route: Route;
  now: number;
  navigate: (route: Route) => void;
  openSession_: (sessionId: string) => void;
}

function routeFromHash(): Route {
  const parts = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  if (parts[0] === "p" && parts[1]) {
    if (parts[2] === "s" && parts[3]) {
      return {
        level: "session",
        projectId: parts[1],
        sessionId: parts[3],
        ...(parts[4] ? { agentId: parts[4] } : {}),
      };
    }
    return { level: "project", projectId: parts[1] };
  }
  return { level: "home" };
}

function hashOf(route: Route): string {
  switch (route.level) {
    case "home":
      return "#/";
    case "project":
      return `#/p/${encodeURIComponent(route.projectId)}`;
    case "session":
      return `#/p/${encodeURIComponent(route.projectId)}/s/${encodeURIComponent(route.sessionId)}${route.agentId ? `/${encodeURIComponent(route.agentId)}` : ""}`;
  }
}

let client: EngineClient | undefined;

export function respondPermission(p: {
  sessionId: string;
  agentId: string;
  requestId: string;
  decision: "allow" | "deny";
}): Promise<void> {
  if (!client) return Promise.reject(new Error("not connected"));
  return client.respondPermission(p);
}

export const useStore = create<Store>((set, get) => ({
  connection: "connecting",
  state: emptyState(),
  rev: 0,
  route: routeFromHash(),
  now: Date.now(),
  navigate: (route) => {
    if (location.hash !== hashOf(route)) history.pushState(null, "", hashOf(route));
    set({ route });
    if (route.level === "session") get().openSession_(route.sessionId);
  },
  openSession_: (sessionId) => {
    if (get().openSession?.id === sessionId) return;
    set({ openSession: { id: sessionId, events: [], loading: true } });
    client
      ?.sessionEvents(sessionId)
      .then((events) => {
        const cur = get().openSession;
        if (cur?.id !== sessionId) return;
        // Keep any live events that arrived while loading.
        const keys = new Set(events.map((e) => e.key));
        set({
          openSession: {
            id: sessionId,
            events: [...events, ...cur.events.filter((e) => !keys.has(e.key))],
            loading: false,
          },
        });
      })
      .catch(() => {
        const cur = get().openSession;
        if (cur?.id === sessionId) set({ openSession: { ...cur, loading: false } });
      });
  },
}));

export async function startEngine() {
  const endpoint = await resolveEndpoint();
  client = new EngineClient(endpoint, {
    onOpen: (snapshot) => {
      useStore.setState((s) => ({ connection: "online", state: snapshot.state, rev: s.rev + 1 }));
      const route = useStore.getState().route;
      if (route.level === "session") {
        useStore.setState({ openSession: undefined });
        useStore.getState().openSession_(route.sessionId);
      }
    },
    onEvents: (batch) => {
      const s = useStore.getState();
      for (const e of batch.events) apply(s.state, e);
      const open = s.openSession;
      const forOpen = open ? batch.events.filter((e) => e.sessionId === open.id) : [];
      useStore.setState({
        rev: s.rev + 1,
        ...(open && forOpen.length
          ? { openSession: { ...open, events: [...open.events, ...forOpen] } }
          : {}),
      });
    },
    onStatus: (engineStatus) => useStore.setState({ engineStatus }),
    onClose: () => useStore.setState({ connection: "offline" }),
  });
  client.start();
  window.addEventListener("popstate", () => useStore.getState().navigate(routeFromHash()));
  const r = useStore.getState().route;
  if (r.level === "session") useStore.getState().openSession_(r.sessionId);
  setInterval(() => useStore.setState({ now: Date.now() }), 1000);
}
