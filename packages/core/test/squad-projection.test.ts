import { describe, expect, test } from "bun:test";
import type { GravitaEvent } from "@gravita/protocol";
import { keys } from "@gravita/protocol/ids";
import {
  apply,
  applyAll,
  emptyState,
  type GravitaState,
  roleBudget,
  squadOfSession,
  squadPlan,
} from "../src";
import { samplePlan } from "./squad-fixture";

const Q = "q1";
const t = (n: number) => `2026-10-13T10:00:${String(n).padStart(2, "0")}.000Z`;
const env = { source: "gravita" as const, provider: "gravita" as const, projectId: "p" };
const plan = samplePlan();
const edited = { ...plan, summary: "An API and a web UI for todos, with due dates." };

/** A squad event; the envelope's session stays empty. */
function sq(n: number, key: string, e: Pick<GravitaEvent, "type" | "data">): GravitaEvent {
  return { ...env, key, ts: t(n), ...e } as GravitaEvent;
}

/** A role session starting, then reporting cumulative cost. */
function roleSession(n: number, sid: string, roleId: string, taskId?: string): GravitaEvent[] {
  const base = {
    source: "sdk" as const,
    provider: "claude" as const,
    projectId: "p",
    sessionId: sid,
  };
  return [
    {
      ...base,
      key: keys.sessionStarted(sid),
      ts: t(n),
      type: "session.started",
      data: {
        kind: "squad",
        cwd: `/w/.gravita/${roleId}`,
        squadId: Q,
        roleId,
        ...(taskId ? { taskId } : {}),
      },
    },
  ];
}
function cost(n: number, sid: string, usd: number): GravitaEvent {
  return {
    source: "sdk",
    provider: "claude",
    projectId: "p",
    sessionId: sid,
    key: `cost:${sid}:${n}`,
    ts: t(n),
    type: "cost.snapshot",
    data: { totalCostUsd: usd },
  };
}

const created = sq(0, keys.squadCreated(Q), {
  type: "squad.created",
  data: {
    squadId: Q,
    cwd: "/w",
    brief: "Todo app",
    models: { planner: "opus", roles: "sonnet" },
    budgetUsd: 20,
    autonomy: "guarded",
    baseBranch: "main",
  },
});

const planning: GravitaEvent[] = [
  created,
  sq(1, keys.squadPhase(Q, "planning", 1), {
    type: "squad.phase_changed",
    data: { squadId: Q, phase: "planning" },
  }),
  ...roleSession(2, "s-plan", "planner"),
  sq(3, keys.planRejected(Q, 1), {
    type: "plan.rejected",
    data: { squadId: Q, attempt: 1, errors: ['Roles "a" and "b" overlap'] },
  }),
  cost(4, "s-plan", 0.8),
  sq(5, keys.planProposed(Q, 2), {
    type: "plan.proposed",
    data: { squadId: Q, attempt: 2, plan },
  }),
  sq(6, keys.squadPhase(Q, "review", 1), {
    type: "squad.phase_changed",
    data: { squadId: Q, phase: "review" },
  }),
  sq(7, keys.planEdited(Q, 1), {
    type: "plan.edited",
    data: { squadId: Q, revision: 1, plan: edited },
  }),
  sq(8, keys.planApproved(Q), { type: "plan.approved", data: { squadId: Q, plan: edited } }),
  sq(9, keys.squadPhase(Q, "foundation", 1), {
    type: "squad.phase_changed",
    data: { squadId: Q, phase: "foundation" },
  }),
];

const status = (
  n: number,
  taskId: string,
  role: string,
  s: "running" | "review" | "done" | "failed",
  attempt = 1,
  sessionId?: string,
) =>
  sq(n, keys.taskStatus(Q, taskId, attempt, s), {
    type: "task.status_changed",
    data: { squadId: Q, taskId, role, status: s, attempt, ...(sessionId ? { sessionId } : {}) },
  });

const building: GravitaEvent[] = [
  status(10, "api-contract", "backend", "running", 1, "s-b1"),
  ...roleSession(11, "s-b1", "backend", "api-contract"),
  cost(12, "s-b1", 1.5),
  cost(13, "s-b1", 2),
  status(14, "api-contract", "backend", "done"),
  sq(15, keys.contractFrozen(Q, "apps/api/openapi.yaml", 1), {
    type: "contract.frozen",
    data: { squadId: Q, path: "apps/api/openapi.yaml", version: 1, sha: "c1" },
  }),
  sq(16, keys.commit(Q, "abc"), {
    type: "commit.created",
    data: {
      squadId: Q,
      role: "backend",
      taskId: "api-contract",
      sha: "abc",
      files: ["apps/api/openapi.yaml"],
    },
  }),
  sq(17, keys.merge(Q, "api-contract", 1, "started"), {
    type: "merge.started",
    data: { squadId: Q, taskId: "api-contract", role: "backend", attempt: 1 },
  }),
  sq(18, keys.merge(Q, "api-contract", 1, "succeeded"), {
    type: "merge.succeeded",
    data: { squadId: Q, taskId: "api-contract", role: "backend", attempt: 1, sha: "m1" },
  }),
  sq(19, keys.squadPhase(Q, "build", 1), {
    type: "squad.phase_changed",
    data: { squadId: Q, phase: "build" },
  }),
  status(20, "api-todos", "backend", "running", 1, "s-b2"),
  ...roleSession(21, "s-b2", "backend", "api-todos"),
  status(22, "web-list", "frontend", "running", 1, "s-f1"),
  ...roleSession(23, "s-f1", "frontend", "web-list"),
  cost(24, "s-b2", 3),
  cost(25, "s-f1", 4.25),
  sq(26, keys.ownershipViolation(Q, "web-list", 1), {
    type: "ownership.violation",
    data: {
      squadId: Q,
      role: "frontend",
      taskId: "web-list",
      attempt: 1,
      paths: ["apps/api/x.ts"],
    },
  }),
  status(27, "web-list", "frontend", "running", 2, "s-f1"),
  sq(28, keys.note(Q, "n1"), {
    type: "note.posted",
    data: {
      squadId: Q,
      noteId: "n1",
      fromRole: "frontend",
      toRole: "backend",
      text: "Need a due date",
    },
  }),
  sq(29, keys.changeRequest(Q, "cr1", "opened"), {
    type: "change_request.opened",
    data: {
      squadId: Q,
      requestId: "cr1",
      fromRole: "frontend",
      toRole: "backend",
      text: "Add due",
    },
  }),
  sq(30, keys.changeRequest(Q, "cr1", "resolved"), {
    type: "change_request.resolved",
    data: { squadId: Q, requestId: "cr1", outcome: "done" },
  }),
  sq(31, keys.checkRan(Q, "api-test", "r1"), {
    type: "check.ran",
    data: { squadId: Q, checkId: "api-test", runId: "r1", ok: false, outputPreview: "1 failed" },
  }),
  sq(32, keys.checkRan(Q, "api-test", "r2"), {
    type: "check.ran",
    data: { squadId: Q, checkId: "api-test", runId: "r2", ok: true },
  }),
  sq(33, keys.budget(Q, "squad", Q, "warned"), {
    type: "budget.warned",
    data: { squadId: Q, scope: "squad", scopeId: Q, usedUsd: 15, limitUsd: 20 },
  }),
  sq(34, keys.squadDelivered(Q), {
    type: "squad.delivered",
    data: { squadId: Q, mode: "pr", ref: "https://example.test/pr/1" },
  }),
];

const all = [...planning, ...building];

describe("squad projection", () => {
  test("a squad's events build its Board state", () => {
    const state = applyAll(emptyState(), all);
    const q = state.squads[Q]!;
    expect(q).toMatchObject({
      created: true,
      cwd: "/w",
      brief: "Todo app",
      budgetUsd: 20,
      autonomy: "guarded",
      baseBranch: "main",
      phase: "build",
      phaseRounds: { planning: 1, review: 1, foundation: 1, build: 1 },
      planStatus: "approved",
      planAttempts: 2,
      planRevision: 1,
      approvedTs: t(8),
      createdTs: t(0),
      lastEventTs: t(34),
    });
    expect(q.plan?.summary).toBe(edited.summary);
    // A newer proposal cleared the rejected attempt's errors.
    expect(q.planErrors).toBeUndefined();
    expect(q.tasks).toEqual({
      "api-contract": {
        status: "done",
        attempt: 1,
        role: "backend",
        sessionId: "s-b1",
        updatedTs: t(14),
      },
      "api-todos": {
        status: "running",
        attempt: 1,
        role: "backend",
        sessionId: "s-b2",
        updatedTs: t(20),
      },
      "web-list": {
        status: "running",
        attempt: 2,
        role: "frontend",
        sessionId: "s-f1",
        updatedTs: t(27),
      },
    });
    expect(q.roles).toEqual({
      planner: { sessionIds: ["s-plan"], currentSessionId: "s-plan", spentUsd: 0.8 },
      backend: { sessionIds: ["s-b1", "s-b2"], currentSessionId: "s-b2", spentUsd: 5 },
      frontend: { sessionIds: ["s-f1"], currentSessionId: "s-f1", spentUsd: 4.25 },
    });
    expect(q.budget).toEqual({ spentUsd: 10.05, warned: ["squad:q1"], exhausted: [] });
    expect(q.contracts).toEqual({ "apps/api/openapi.yaml": { version: 1, sha: "c1", ts: t(15) } });
    expect(q.commits.map((c) => c.sha)).toEqual(["abc"]);
    expect(q.merges["api-contract:1"]).toMatchObject({ state: "succeeded", sha: "m1" });
    expect(q.violations).toEqual([
      { role: "frontend", taskId: "web-list", attempt: 1, paths: ["apps/api/x.ts"], ts: t(26) },
    ]);
    expect(q.notes.map((n) => n.noteId)).toEqual(["n1"]);
    expect(q.changeRequests.cr1).toMatchObject({
      state: "done",
      openedTs: t(29),
      resolvedTs: t(30),
    });
    expect(q.checks["api-test"]).toEqual({ ok: true, runId: "r2", ts: t(32) });
    expect(q.delivered).toEqual({ mode: "pr", ref: "https://example.test/pr/1", ts: t(34) });

    const s = state.sessions["s-b2"]!;
    expect(s).toMatchObject({ squadId: Q, roleId: "backend", taskId: "api-todos", kind: "squad" });
    expect(squadOfSession(state, "s-b2")).toBe(q);
    expect(squadOfSession(state, "nope")).toBeUndefined();
    // Squad events don't create sessions.
    expect(Object.keys(state.sessions).sort()).toEqual(["s-b1", "s-b2", "s-f1", "s-plan"]);
  });

  test("role sessions and costs arriving before squad.created give the same squad", () => {
    const sessionFirst = [...all.filter((e) => e.sessionId), ...all.filter((e) => !e.sessionId)];
    const expected = applyAll(emptyState(), all).squads[Q];
    expect(applyAll(emptyState(), sessionFirst).squads[Q]).toEqual(expected!);
  });

  test("before squad.created, a role session makes a stub squad", () => {
    const state = applyAll(emptyState(), [
      ...roleSession(2, "s-plan", "planner"),
      cost(3, "s-plan", 1),
    ]);
    expect(state.squads[Q]).toMatchObject({
      created: false,
      phase: "brief",
      planStatus: "none",
      sessionIds: ["s-plan"],
      budget: { spentUsd: 1 },
    });
  });

  test("re-applying a status event is harmless; an older attempt doesn't win", () => {
    const state = applyAll(emptyState(), all);
    const before = structuredClone(state.squads[Q]);
    apply(state, status(14, "api-contract", "backend", "done"));
    apply(state, status(22, "web-list", "frontend", "running", 1, "s-f1"));
    expect(state.squads[Q]).toEqual(before!);
  });

  test("a merge never moves back, and a late approval keeps tasks that already moved", () => {
    const state = applyAll(emptyState(), all);
    apply(
      state,
      sq(17, keys.merge(Q, "api-contract", 1, "started"), {
        type: "merge.started",
        data: { squadId: Q, taskId: "api-contract", role: "backend", attempt: 1 },
      }),
    );
    expect(state.squads[Q]!.merges["api-contract:1"]!.state).toBe("succeeded");
    apply(
      state,
      sq(8, keys.planApproved(Q), { type: "plan.approved", data: { squadId: Q, plan } }),
    );
    expect(state.squads[Q]!.tasks["api-contract"]!.status).toBe("done");
  });

  test("an older snapshot without squads still applies squad events", () => {
    const old = { projects: {}, sessions: {}, seq: 0 } as unknown as GravitaState;
    apply(old, created);
    expect(old.squads[Q]!.brief).toBe("Todo app");
  });

  test("pause and resume: the latest wins, and each is counted for its key", () => {
    const state = applyAll(emptyState(), [created]);
    const pause = (n: number, i: number, reason: string) =>
      sq(n, keys.squadPaused(Q, i), { type: "squad.paused", data: { squadId: Q, reason } });
    const resume = (n: number, i: number) =>
      sq(n, keys.squadResumed(Q, i), { type: "squad.resumed", data: { squadId: Q } });
    apply(state, pause(10, 1, "Budget used up"));
    expect(state.squads[Q]!.paused).toEqual({ reason: "Budget used up", ts: t(10) });
    apply(state, resume(11, 1));
    expect(state.squads[Q]!.paused).toBeUndefined();
    apply(state, pause(13, 2, "Gravita restarted"));
    // A resume older than the pause (out of order) doesn't lift it.
    apply(state, resume(12, 2));
    expect(state.squads[Q]!.paused?.reason).toBe("Gravita restarted");
    expect([state.squads[Q]!.pauseCount, state.squads[Q]!.resumeCount]).toEqual([2, 2]);
  });

  test("tasks added after approval join the plan the squad runs, once", () => {
    const state = applyAll(emptyState(), [
      created,
      sq(8, keys.planApproved(Q), {
        type: "plan.approved",
        data: { squadId: Q, plan, answers: { "Dark mode?": "Yes" } },
      }),
    ]);
    const task = {
      id: "cr-1",
      role: "backend",
      title: "Change request from Frontend",
      plainSummary: "Add a due date to todos.",
      dependsOn: [],
      writes: ["apps/api/"],
      acceptance: ["Todos carry a due date"],
      size: "s" as const,
    };
    const added = sq(20, keys.taskAdded(Q, "cr-1"), {
      type: "task.added",
      data: { squadId: Q, task, origin: "change_request", fromRole: "frontend" },
    });
    apply(state, added);
    apply(state, { ...added, ts: t(21) });
    const q = state.squads[Q]!;
    expect(q.answers).toEqual({ "Dark mode?": "Yes" });
    expect(q.addedTasks).toHaveLength(1);
    expect(q.tasks["cr-1"]).toMatchObject({ status: "pending", attempt: 1, role: "backend" });
    expect(squadPlan(q)!.tasks.map((x) => x.id)).toEqual([...plan.tasks.map((x) => x.id), "cr-1"]);
  });

  test("several bounces within one attempt are each recorded", () => {
    const state = applyAll(emptyState(), [created]);
    const v = (n: number, bounce?: number) =>
      sq(n, keys.ownershipViolation(Q, "web-list", 1, bounce), {
        type: "ownership.violation",
        data: {
          squadId: Q,
          role: "frontend",
          taskId: "web-list",
          attempt: 1,
          paths: ["apps/api/x.ts"],
          ...(bounce ? { bounce } : {}),
        },
      });
    applyAll(state, [v(10), v(11, 2), v(12, 2)]);
    expect(state.squads[Q]!.violations.map((x) => x.bounce ?? 1)).toEqual([1, 2]);
  });

  test("a session's cost never goes down: a crash result reporting 0 doesn't undo spend", () => {
    const state = applyAll(emptyState(), [created, ...roleSession(1, "s-x", "backend")]);
    applyAll(state, [cost(2, "s-x", 2.5), cost(3, "s-x", 0)]);
    expect(state.sessions["s-x"]?.costUsd).toBe(2.5);
    expect(state.squads[Q]!.budget.spentUsd).toBe(2.5);
  });

  test("a raised budget applies and re-arms the levels of the scopes it changed", () => {
    const state = applyAll(emptyState(), [
      created,
      sq(8, keys.planApproved(Q), { type: "plan.approved", data: { squadId: Q, plan } }),
    ]);
    const level = (
      n: number,
      type: "budget.warned" | "budget.exhausted",
      scope: "squad" | "role",
      id: string,
    ) =>
      sq(n, keys.budget(Q, scope, id, type === "budget.warned" ? "warned" : "exhausted"), {
        type,
        data: { squadId: Q, scope, scopeId: id, usedUsd: 20, limitUsd: 20 },
      });
    applyAll(state, [
      level(10, "budget.warned", "squad", Q),
      level(11, "budget.exhausted", "squad", Q),
      level(12, "budget.exhausted", "role", "backend"),
      level(13, "budget.exhausted", "role", "frontend"),
    ]);
    apply(
      state,
      sq(14, keys.budgetChanged(Q, 1), {
        type: "squad.budget_changed",
        data: { squadId: Q, budgetUsd: 35, previousUsd: 20, roleBudgets: { backend: 8 } },
      }),
    );
    const q = state.squads[Q]!;
    expect(q.budgetUsd).toBe(35);
    expect(q.budgetChanges).toBe(1);
    expect(q.budget.warned).toEqual([]);
    expect(q.budget.exhausted).toEqual(["role:frontend"]);
    expect(roleBudget(q, "backend")).toBe(8);
    expect(roleBudget(q, "frontend")).toBeUndefined();
  });
});
