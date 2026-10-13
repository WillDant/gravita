import { afterEach, describe, expect, it } from "vitest";
import type { Route } from "@/state/slices/route";
import { createHashRouter, hashOf, parseHash } from "./router";

afterEach(() => window.history.replaceState(null, "", "#/"));

describe("hash routes", () => {
  const routes: Route[] = [
    { level: "home" },
    { level: "project", projectId: "/work/my app" },
    { level: "session", projectId: "p", sessionId: "s/1" },
    { level: "session", projectId: "p", sessionId: "s", agentId: "a" },
    { level: "squad", projectId: "p", squadId: "sq-1" },
    { level: "squad", projectId: "p", squadId: "sq/1", taskId: "api-routes" },
  ];

  it("round-trip through the hash", () => {
    for (const r of routes) expect(parseHash(hashOf(r))).toEqual(r);
  });

  it("open a squad at #/p/:projectId/q/:squadId", () => {
    expect(parseHash("#/p/p1/q/sq-1")).toEqual({
      level: "squad",
      projectId: "p1",
      squadId: "sq-1",
    });
    expect(hashOf({ level: "squad", projectId: "p1", squadId: "sq-1", taskId: "t1" })).toBe(
      "#/p/p1/q/sq-1/t/t1",
    );
  });

  it("open the persona gallery in dev builds", () => {
    expect(parseHash("#/gallery")).toEqual({ level: "gallery" });
    expect(hashOf({ level: "gallery" })).toBe("#/gallery");
  });

  it("fall back to home for anything else", () => {
    expect(parseHash("")).toEqual({ level: "home" });
    expect(parseHash("#/x/y")).toEqual({ level: "home" });
  });
});

describe("createHashRouter", () => {
  it("pushes the hash, notifies subscribers and follows back/forward until disposed", () => {
    const router = createHashRouter(window);
    const seen: Route[] = [];
    router.subscribe((r) => seen.push(r));

    router.navigate({ level: "project", projectId: "p" });
    expect(window.location.hash).toBe("#/p/p");
    expect(router.current()).toEqual({ level: "project", projectId: "p" });

    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(seen).toHaveLength(2);

    router.dispose();
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(seen).toHaveLength(2);
  });
});
