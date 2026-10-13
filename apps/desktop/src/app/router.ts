import type { Route } from "@/state/slices/route";

// Hash routing, as its own module: parse/format are pure; the router owns the
// history listener and lets the app subscribe to route changes.

export type { Route };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  // Production builds drop this branch (and with it the gallery chunk).
  if (import.meta.env.DEV && parts[0] === "gallery") return { level: "gallery" };
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

export function hashOf(route: Route): string {
  switch (route.level) {
    case "home":
      return "#/";
    case "gallery":
      return "#/gallery";
    case "project":
      return `#/p/${encodeURIComponent(route.projectId)}`;
    case "session":
      return `#/p/${encodeURIComponent(route.projectId)}/s/${encodeURIComponent(route.sessionId)}${route.agentId ? `/${encodeURIComponent(route.agentId)}` : ""}`;
  }
}

export interface Router {
  current(): Route;
  /** Pushes a history entry (when the hash changes) and notifies subscribers. */
  navigate(route: Route): void;
  subscribe(listener: (route: Route) => void): () => void;
  /** Removes the history listener. */
  dispose(): void;
}

export function createHashRouter(win: Window = window): Router {
  const listeners = new Set<(route: Route) => void>();
  const emit = (route: Route) => {
    for (const l of listeners) l(route);
  };
  const onPopState = () => emit(parseHash(win.location.hash));
  win.addEventListener("popstate", onPopState);

  return {
    current: () => parseHash(win.location.hash),
    navigate(route) {
      const hash = hashOf(route);
      if (win.location.hash !== hash) win.history.pushState(null, "", hash);
      emit(route);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      win.removeEventListener("popstate", onPopState);
      listeners.clear();
    },
  };
}
