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
  ];

  it("round-trip through the hash", () => {
    for (const r of routes) expect(parseHash(hashOf(r))).toEqual(r);
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
