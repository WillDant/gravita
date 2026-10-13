import { describe, expect, it } from "vitest";
import { ago, ev, NOW, started, stateOf } from "@/test/events";
import { needsYou, projectSummaries, sessionStatus, totals, trayCounts } from "./selectors";

const at = (sessionId: string, minutesAgo: number, agentId?: string, projectId = "p1") => ({
  ts: ago(minutesAgo),
  projectId,
  sessionId,
  ...(agentId ? { agentId } : {}),
});

const spawn = (sessionId: string, agentId: string, minutesAgo: number, projectId = "p1") =>
  ev(
    "agent.spawned",
    { parentAgentId: "main", agentType: "Explore", depth: 1, background: false },
    at(sessionId, minutesAgo, agentId, projectId),
  );

const ask = (sessionId: string, agentId: string, minutesAgo: number, projectId = "p1") =>
  ev(
    "permission.requested",
    { requestId: `${sessionId}:${agentId}:req`, toolName: "Bash", inputPreview: "pnpm i" },
    at(sessionId, minutesAgo, agentId, projectId),
  );

const live = (sessionId: string, minutesAgo: number, projectId = "p1") =>
  ev("session.presence", { status: "busy" }, at(sessionId, minutesAgo, undefined, projectId));

describe("sessionStatus", () => {
  it("is waiting when any agent asks for permission", () => {
    const s = stateOf(started("s", 3), [live("s", 2), spawn("s", "a", 2), ask("s", "a", 1)]);
    expect(sessionStatus(s.sessions.s!, NOW)).toBe("waiting");
  });

  it("is running while an agent works", () => {
    const s = stateOf(started("s", 3), [live("s", 1)]);
    expect(sessionStatus(s.sessions.s!, NOW)).toBe("running");
  });

  it("is idle after a turn in the live window, done once it's old", () => {
    const recent = stateOf(started("s", 5), [ev("turn.completed", {}, at("s", 4))]);
    expect(sessionStatus(recent.sessions.s!, NOW)).toBe("idle");
    const old = stateOf(started("s", 90), [ev("turn.completed", {}, at("s", 80))]);
    expect(sessionStatus(old.sessions.s!, NOW)).toBe("done");
  });

  it("is an error when the main agent failed, detached when the session let go", () => {
    const failed = stateOf(started("s", 5), [
      ev("agent.completed", { status: "failed" }, at("s", 4, "main")),
    ]);
    expect(sessionStatus(failed.sessions.s!, NOW)).toBe("error");
    const detached = stateOf(started("s", 5), [
      ev("session.detached", { reason: "closed" }, at("s", 4)),
    ]);
    expect(sessionStatus(detached.sessions.s!, NOW)).toBe("detached");
  });
});

describe("projectSummaries", () => {
  const state = stateOf(
    // quiet: nothing live, but the most recent activity
    started("q", 2, "quiet"),
    [ev("turn.completed", {}, at("q", 1, undefined, "quiet"))],
    // busy: one agent running, older
    started("b", 30, "busy"),
    [live("b", 20, "busy")],
    // asking: someone waiting, oldest
    started("w", 50, "asking"),
    [live("w", 45, "asking"), spawn("w", "a", 45, "asking"), ask("w", "a", 40, "asking")],
    // a project without sessions is left out
    [ev("project.discovered", { root: "/work/empty", name: "empty" }, { projectId: "empty" })],
  );

  it("orders by waiting, then running, then most recent activity", () => {
    expect(projectSummaries(state, NOW).map((p) => p.project.id)).toEqual([
      "asking",
      "busy",
      "quiet",
    ]);
  });

  it("counts running, waiting and subagents per project and in total", () => {
    const summaries = projectSummaries(state, NOW);
    const asking = summaries.find((p) => p.project.id === "asking")!;
    expect(asking.counts).toEqual({ running: 1, subagents: 0, waiting: 1, subagentsTotal: 1 });
    expect(asking.live.map((l) => l.agent.id)).toEqual(["main", "a"]);
    expect(totals(summaries)).toEqual({ running: 2, subagents: 0, waiting: 1, subagentsTotal: 1 });
  });

  it("sorts each project's sessions newest first", () => {
    const two = stateOf(started("old", 30), started("new", 5));
    expect(projectSummaries(two, NOW)[0]!.sessions.map((s) => s.id)).toEqual(["new", "old"]);
  });
});

describe("needsYou", () => {
  it("lists every waiting agent across projects, most recent first", () => {
    const state = stateOf(
      started("s1", 30, "p1"),
      [live("s1", 20, "p1"), spawn("s1", "a", 20, "p1"), ask("s1", "a", 10, "p1")],
      started("s2", 30, "p2"),
      [live("s2", 20, "p2"), spawn("s2", "b", 20, "p2"), ask("s2", "b", 2, "p2")],
    );
    expect(
      needsYou(state, NOW).map((w) => `${w.project.id}/${w.session.id}/${w.agent.id}`),
    ).toEqual(["p2/s2/b", "p1/s1/a"]);
  });

  it("is empty when nobody waits", () => {
    expect(needsYou(stateOf(started("s", 3), [live("s", 1)]), NOW)).toEqual([]);
  });
});

describe("trayCounts", () => {
  it("counts running agents, waiting agents and the Gravita sessions Stop all reaches", () => {
    const control = (sessionId: string) =>
      ev("session.control", { controllable: true }, at(sessionId, 1));
    const s = stateOf(
      started("ext", 3),
      started("chat", 3, "p1", "chat"),
      started("quiet", 3, "p1", "chat"),
      [live("ext", 1), spawn("ext", "a", 1)],
      [live("chat", 1), control("chat"), spawn("chat", "b", 1), ask("chat", "b", 0)],
      [control("quiet"), ev("turn.completed", {}, at("quiet", 1))],
    );
    // ext: main + a running; chat: main running, b waiting; quiet: idle chat.
    expect(trayCounts(s, NOW)).toEqual({ running: 3, waiting: 1, controllable: 1 });
  });

  it("is all zeros with nothing loaded", () => {
    expect(trayCounts(stateOf(), NOW)).toEqual({ running: 0, waiting: 0, controllable: 0 });
  });
});
