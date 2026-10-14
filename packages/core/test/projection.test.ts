import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { readSession } from "@gravita/adapter-claude";
import type { GravitaEvent } from "@gravita/protocol";
import fc from "fast-check";
import { applyAll, buildLineMap, emptyState, sessionCounts, toPersona } from "../src";

const FIXTURE = join(
  import.meta.dir,
  "../../../fixtures/claude/2.1.296/nested-background/11111111-1111-4111-8111-111111111111.jsonl",
);
const SID = "11111111-1111-4111-8111-111111111111";

function dedupe(events: GravitaEvent[]): GravitaEvent[] {
  const seen = new Set<string>();
  return events.filter((e) => {
    if (seen.has(e.key)) return false;
    seen.add(e.key);
    return true;
  });
}

/** The parts of a projection that must not depend on event order. */
function invariants(events: GravitaEvent[]) {
  const s = applyAll(emptyState(), dedupe(events)).sessions[SID]!;
  return Object.values(s.agents)
    .map((a) => ({
      id: a.id,
      parent: a.parentId,
      type: a.agentType,
      terminal: a.id === "main" ? null : a.lifecycle,
      tokens: a.tokens,
      files: [...a.filesTouched].sort(),
    }))
    .sort((x, y) => x.id.localeCompare(y.id));
}

describe("projection", () => {
  test("builds the agent tree with lifecycles, tokens and files", async () => {
    const events = await readSession(FIXTURE, { projectId: "p1" });
    const state = applyAll(emptyState(), dedupe(events));
    const s = state.sessions[SID]!;
    expect(s.title).toBe("Auth flow mapping");
    expect(s.agents.main!.children.sort()).toEqual(["a0000000000000001", "a0000000000000002"]);
    expect(s.agents.a0000000000000002!.children).toEqual(["a0000000000000003"]);
    expect(s.agents.a0000000000000003!.depth).toBe(2);
    for (const id of ["a0000000000000001", "a0000000000000002", "a0000000000000003"]) {
      expect(s.agents[id]!.lifecycle).toBe("done");
    }
    expect(s.agents.main!.lifecycle).toBe("idle");
    // msg_3 was written twice (output 1 then 40): counted once, at its max.
    expect(s.agents.main!.tokens.output).toBe(10 + 12 + 40 + 30);
    expect(s.agents.a0000000000000003!.filesTouched).toEqual(["/work/demo/src/auth/login.ts"]);
    expect(state.projects.p1!.name).toBe("demo");
  });

  test("ingesting twice equals ingesting once", async () => {
    const events = await readSession(FIXTURE, { projectId: "p1" });
    expect(invariants([...events, ...events])).toEqual(invariants(events));
  });

  test("tree, terminal states and tokens do not depend on event order", async () => {
    const events = await readSession(FIXTURE, { projectId: "p1" });
    const expected = invariants(events);
    fc.assert(
      fc.property(fc.shuffledSubarray(events, { minLength: events.length }), (shuffled) => {
        expect(invariants(shuffled)).toEqual(expected);
      }),
      { numRuns: 200 },
    );
  });

  test("counts and personas for a finished session read later", async () => {
    const events = await readSession(FIXTURE, { projectId: "p1" });
    const s = applyAll(emptyState(), dedupe(events)).sessions[SID]!;
    const later = Date.parse("2026-10-12T12:00:00.000Z");
    expect(sessionCounts(s, later)).toEqual({
      running: 0,
      subagents: 0,
      waiting: 0,
      subagentsTotal: 3,
    });
    expect(toPersona(s.agents.a0000000000000001!, s, later).mood).toBe("done");
    expect(toPersona(s.agents.main!, s, later).mood).toBe("idle");
  });

  test("a live subagent with a tool in flight reads as working, and is counted", () => {
    const base = {
      source: "sdk" as const,
      provider: "claude" as const,
      projectId: "p",
      sessionId: "s",
    };
    const now = Date.parse("2026-10-12T10:00:10.000Z");
    const events: GravitaEvent[] = [
      {
        ...base,
        key: "1",
        ts: "2026-10-12T10:00:00.000Z",
        type: "session.started",
        data: { kind: "chat", cwd: "/w/app" },
      },
      {
        ...base,
        key: "2",
        ts: "2026-10-12T10:00:01.000Z",
        type: "session.presence",
        data: { status: "busy" },
      },
      {
        ...base,
        key: "3",
        ts: "2026-10-12T10:00:02.000Z",
        agentId: "a1",
        type: "agent.spawned",
        data: { parentAgentId: "main", agentType: "Explore", depth: 1, background: true },
      },
      {
        ...base,
        key: "4",
        ts: "2026-10-12T10:00:05.000Z",
        agentId: "a1",
        type: "tool.started",
        data: {
          toolUseId: "t1",
          name: "Read",
          kind: "read",
          target: { path: "/w/app/src/index.ts" },
          inputPreview: "index.ts",
        },
      },
      {
        ...base,
        key: "5",
        ts: "2026-10-12T10:00:06.000Z",
        agentId: "a2",
        type: "agent.spawned",
        data: { parentAgentId: "main", agentType: "Plan", depth: 1, background: true },
      },
      {
        ...base,
        key: "6",
        ts: "2026-10-12T10:00:07.000Z",
        agentId: "a2",
        type: "permission.requested",
        data: { requestId: "r1", toolName: "Bash", inputPreview: "pnpm add jose" },
      },
    ];
    const s = applyAll(emptyState(), events).sessions.s!;
    const p = toPersona(s.agents.a1!, s, now);
    expect(p).toMatchObject({
      activity: "reading",
      gaze: { kind: "tool", toolKind: "read" },
      label: { key: "persona.reading", params: { target: "index.ts" } },
    });
    expect(toPersona(s.agents.a2!, s, now).gaze).toEqual({ kind: "viewer" });
    expect(sessionCounts(s, now)).toEqual({
      running: 2,
      subagents: 1,
      waiting: 1,
      subagentsTotal: 2,
    });
  });

  test("only new work brings a finished agent back; a late running report doesn't", () => {
    const base = {
      source: "codex-rollout" as const,
      provider: "codex" as const,
      projectId: "p",
      sessionId: "s",
      agentId: "a1",
      ts: "2026-10-12T10:00:00.000Z",
    };
    const done: GravitaEvent = {
      ...base,
      key: "1",
      type: "agent.completed",
      data: { status: "completed" },
    };
    const late: GravitaEvent = {
      ...base,
      key: "2",
      type: "agent.lifecycle",
      data: { status: "running" },
    };
    const resumed: GravitaEvent = {
      ...base,
      key: "3",
      type: "agent.lifecycle",
      data: { status: "running", resumed: true },
    };
    const lifecycle = (events: GravitaEvent[]) =>
      applyAll(emptyState(), events).sessions.s!.agents.a1!.lifecycle;
    expect(lifecycle([done, late])).toBe("done");
    expect(lifecycle([done, resumed])).toBe("active");
    expect(lifecycle([done, resumed, { ...done, key: "4" }])).toBe("done");
    // The line map reopens its line until it completes again.
    const line = (events: GravitaEvent[]) =>
      buildLineMap(events).lines.find((l) => l.agentId === "a1");
    expect(line([done, late])?.ended).toBe(true);
    expect(line([done, resumed])?.ended).toBe(false);
    expect(line([done, resumed, { ...done, key: "4" }])?.ended).toBe(true);
  });
});

describe("questions, settings and Gravita prompts", () => {
  const base = {
    source: "sdk" as const,
    provider: "claude" as const,
    projectId: "p",
    sessionId: "q",
  };
  const t = (n: number) => `2026-10-12T10:00:0${n}.000Z`;
  const events: GravitaEvent[] = [
    {
      ...base,
      key: "q1",
      ts: t(0),
      type: "session.started",
      data: { kind: "chat", cwd: "/w/app" },
    },
    {
      ...base,
      key: "q2",
      ts: t(1),
      type: "session.settings",
      data: { model: "haiku", permissionMode: "default" },
    },
    {
      ...base,
      key: "q3",
      ts: t(2),
      type: "message.user",
      data: { uuid: "u1", textPreview: "Map the repo", origin: "gravita" },
    },
    {
      ...base,
      key: "q4",
      ts: t(3),
      type: "question.asked",
      data: {
        requestId: "r1",
        questions: [
          {
            question: "Which DB?",
            multiSelect: false,
            options: [{ label: "SQLite" }, { label: "Postgres" }],
          },
        ],
      },
    },
  ];

  test("a Gravita prompt activates main and titles the session; settings land on the session", () => {
    const s = applyAll(emptyState(), events).sessions.q!;
    expect(s.firstUserText).toBe("Map the repo");
    expect(s.model).toBe("haiku");
    expect(s.permissionMode).toBe("default");
  });

  test("a question waits on the user and reads as asking; answering releases it", () => {
    const state = applyAll(emptyState(), events);
    const s = state.sessions.q!;
    const now = Date.parse(t(4));
    expect(s.agents.main!.lifecycle).toBe("waiting_user");
    expect(toPersona(s.agents.main!, s, now).label.key).toBe("persona.asking");
    applyAll(state, [
      {
        ...base,
        key: "q5",
        ts: t(5),
        type: "question.answered",
        data: { requestId: "r1", by: "user" },
      },
    ]);
    expect(s.agents.main!.questions).toEqual({});
    expect(s.agents.main!.lifecycle).toBe("active");
  });
});

describe("session model", () => {
  test("session.started names the model until session.settings changes it", () => {
    const base = {
      ts: "2026-10-13T10:00:00.000Z",
      source: "codex-rollout" as const,
      provider: "codex" as const,
      projectId: "p",
      sessionId: "codex:s1",
    };
    const state = applyAll(emptyState(), [
      {
        ...base,
        key: "session:codex:s1:started",
        type: "session.started",
        data: { kind: "external", cwd: "/r", model: "gpt-6-sol" },
      },
    ] as GravitaEvent[]);
    expect(state.sessions["codex:s1"]?.model).toBe("gpt-6-sol");
    applyAll(state, [
      {
        ...base,
        key: "settings:codex:s1:1",
        type: "session.settings",
        data: { model: "gpt-6-luna" },
      },
    ] as GravitaEvent[]);
    expect(state.sessions["codex:s1"]?.model).toBe("gpt-6-luna");
  });

  test("a resumed session's main agent comes back from detached", () => {
    const base = {
      projectId: "p1",
      sessionId: "r1",
      source: "registry",
      provider: "claude",
    } as const;
    const at = (n: number) => new Date(Date.UTC(2026, 9, 14, 12, 0, n)).toISOString();
    const events = [
      {
        ...base,
        key: "s",
        ts: at(0),
        type: "session.started",
        data: { kind: "external", cwd: "/w" },
      },
      { ...base, key: "p1", ts: at(1), type: "session.presence", data: { pid: 1, status: "idle" } },
      { ...base, key: "d1", ts: at(2), type: "session.detached", data: { pid: 1 } },
    ] as GravitaEvent[];
    const detached = applyAll(emptyState(), events).sessions.r1!;
    expect(detached.agents.main!.lifecycle).toBe("detached");
    const resumed = applyAll(emptyState(), [
      ...events,
      { ...base, key: "p2", ts: at(3), type: "session.presence", data: { pid: 2, status: "idle" } },
    ] as GravitaEvent[]).sessions.r1!;
    expect(resumed.live).toBe(true);
    expect(resumed.agents.main!.lifecycle).toBe("idle");
  });
});
