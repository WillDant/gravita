import { describe, expect, test } from "bun:test";
import { scenarioEvents } from "@gravita/adapter-fake";
import type { EventsNotification, GravitaEvent } from "@gravita/protocol";
import { RespondToPermission } from "../../src/application/usecases/respond-to-permission";
import { NotControllableError } from "../../src/domain/errors";
import { DemoRuntime } from "../../src/infrastructure/demo/demo-runtime";
import { createCore } from "../../src/main/container";

const NOW = () => Date.parse("2026-10-12T10:00:00.000Z");

function setup() {
  const core = createCore({ dbPath: ":memory:", demo: true });
  const demo = new DemoRuntime({
    seed: 1,
    ingest: core.ingest,
    runtimes: core.runtimes,
    sessions: core.projection,
    clock: core.clock,
  });
  const published: GravitaEvent[] = [];
  core.broadcaster.listen({ events: (n: EventsNotification) => published.push(...n.events) });
  const story = scenarioEvents({ seed: 1, now: NOW }, 400_000).values();
  /** Plays the story on from where it stopped, up to the first event matching `until`. */
  const playUntil = (until: (e: GravitaEvent) => boolean): GravitaEvent => {
    for (const e of story) {
      demo.play(e);
      if (until(e)) return e;
    }
    throw new Error("the story never got there");
  };
  return { core, published, playUntil };
}

describe("DemoRuntime", () => {
  test("a demo session is controllable while it runs, and announces it", () => {
    const { core, published, playUntil } = setup();
    const started = playUntil((e) => e.type === "session.started");
    const sid = started.sessionId!;
    expect(core.runtimes.get(sid)).toBeDefined();
    expect(core.projection.session(sid)!.controllable).toBe(true);

    playUntil((e) => e.type === "session.ended" && e.sessionId === sid);
    expect(core.runtimes.get(sid)).toBeUndefined();
    expect(core.projection.session(sid)!.controllable).toBe(false);

    core.broadcaster.flush();
    const control = published.filter((e) => e.type === "session.control" && e.sessionId === sid);
    expect(control.map((e) => e.type === "session.control" && e.data.controllable)).toEqual([
      true,
      false,
    ]);
    // Control is ephemeral: never stored.
    expect(core.events.sessionEvents(sid).some((e) => e.type === "session.control")).toBe(false);
    core.close();
  });

  test("answers a pending permission once; the scripted answer then changes nothing", async () => {
    const { core, playUntil } = setup();
    const asked = playUntil((e) => e.type === "permission.requested");
    if (asked.type !== "permission.requested") throw new Error("unreachable");
    const respond = new RespondToPermission(core.runtimes);
    const p = {
      sessionId: asked.sessionId!,
      agentId: asked.agentId!,
      requestId: asked.data.requestId,
      decision: "deny" as const,
    };

    expect(await respond.execute(p)).toEqual({ ok: true });
    const resolved = core.events
      .sessionEvents(p.sessionId)
      .filter((e) => e.type === "permission.resolved");
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({
      source: "gravita",
      agentId: p.agentId,
      data: { requestId: p.requestId, decision: "deny", by: "user" },
    });
    expect(core.projection.session(p.sessionId)!.agents[p.agentId]!.pendingPermissions).toEqual([]);

    // No longer pending: refused, like a session Gravita doesn't control.
    expect(await respond.execute(p).catch((e) => e)).toBeInstanceOf(NotControllableError);
    const wrongAgent = { ...p, agentId: "main", requestId: "nope" };
    expect(await respond.execute(wrongAgent).catch((e) => e)).toBeInstanceOf(NotControllableError);

    playUntil((e) => e.type === "permission.resolved" && e.data.requestId === p.requestId);
    const after = core.events
      .sessionEvents(p.sessionId)
      .filter((e) => e.type === "permission.resolved");
    expect(after).toEqual(resolved);
    core.close();
  });

  test("takes model and mode changes; refuses what a script can't do", async () => {
    const { core, playUntil } = setup();
    const sid = playUntil((e) => e.type === "session.started").sessionId!;
    const r = core.runtimes.get(sid)!;
    const refused = [
      () => r.send("hi", "u1"),
      () => r.interrupt(),
      () => r.stopAgent("main"),
      () => r.answerQuestion("main", "q1", { a: "b" }),
    ];
    for (const call of refused) await expect(call()).rejects.toBeInstanceOf(NotControllableError);
    expect(
      await core.router.dispatch("session.setModel", { sessionId: sid, model: "opus" }),
    ).toEqual({ result: { ok: true } });
    expect(core.projection.session(sid)!.model).toBe("opus");
    expect(
      await core.router.dispatch("session.send", { sessionId: sid, text: "hi" }),
    ).toMatchObject({
      error: { code: 4004 },
    });
    expect(
      await core.router.dispatch("session.start", { cwd: "/tmp", prompt: "hi" }),
    ).toMatchObject({
      error: { code: 4005 },
    });
  });
});
