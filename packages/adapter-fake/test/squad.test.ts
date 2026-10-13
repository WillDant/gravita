import { describe, expect, test } from "bun:test";
import { applyAll, emptyState, validatePlan } from "@gravita/core";
import {
  type EventOf,
  type GravitaEvent,
  GravitaEvent as GravitaEventSchema,
  SquadPlan,
  type TaskStatus,
} from "@gravita/protocol";
import {
  DEMO_PROJECTS,
  SAMPLE_SQUAD_PLAN,
  SQUAD_BUDGET_USD,
  SQUAD_START_MS,
  scenarioEvents,
  squadRun,
} from "../src";

const first = squadRun(1, 0, 0);
const events = first.events.map((t) => t.event);
const squadId = (events[0] as EventOf<"squad.created">).data.squadId;

const ofType = <T extends GravitaEvent["type"]>(type: T) =>
  events.filter((e): e is EventOf<T> => e.type === type);

const started = ofType("session.started");
const sessionsById = new Map(started.map((e) => [e.sessionId!, e]));

/** Inside a prefix, segment-aware: "apps/api/" holds "apps/api/x", not "apps/apix". */
const within = (path: string, prefix: string) =>
  prefix.endsWith("/") ? path.startsWith(prefix) : path === prefix || path.startsWith(`${prefix}/`);

const LEGAL: Record<TaskStatus, TaskStatus[]> = {
  pending: ["ready", "blocked", "skipped"],
  ready: ["running", "blocked", "skipped"],
  running: ["review", "blocked", "failed"],
  blocked: ["ready", "running", "skipped"],
  review: ["done", "running", "failed"],
  failed: ["running", "skipped"],
  done: [],
  skipped: [],
};

describe("SAMPLE_SQUAD_PLAN", () => {
  test("parses as a SquadPlan", () => {
    expect(SquadPlan.safeParse(SAMPLE_SQUAD_PLAN).success).toBe(true);
  });

  test("passes @gravita/core's validatePlan", () => {
    expect(validatePlan(SAMPLE_SQUAD_PLAN)).toEqual([]);
  });

  test("has two foundation tasks, both the backend's, before any build task", () => {
    const foundation = SAMPLE_SQUAD_PLAN.tasks.filter((t) => t.foundation);
    expect(foundation.map((t) => [t.id, t.role])).toEqual([
      ["scaffold-api", "backend"],
      ["contracts", "backend"],
    ]);
    expect(SAMPLE_SQUAD_PLAN.tasks).toHaveLength(9);
  });
});

describe("squad story", () => {
  test("every event of the first loop is a valid GravitaEvent, with unique keys", () => {
    for (const e of events) {
      const parsed = GravitaEventSchema.safeParse(e);
      expect({ type: e.type, ok: parsed.success }).toEqual({ type: e.type, ok: true });
    }
    const second = squadRun(1, 1, first.next).events.map((t) => t.event);
    const keys = [...events, ...second].map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("squad facts are fake, belong to the squad and carry no session", () => {
    const facts = events.filter((e) => !e.sessionId);
    expect(facts.length).toBeGreaterThan(50);
    for (const e of facts) {
      expect(e).toMatchObject({
        source: "fake",
        provider: "fake",
        projectId: DEMO_PROJECTS.todo.id,
      });
      expect((e.data as { squadId?: string }).squadId).toBe(squadId);
    }
    expect(ofType("squad.created")[0]!.data).toMatchObject({
      cwd: DEMO_PROJECTS.todo.root,
      models: { planner: "opus", roles: "opus" },
      budgetUsd: 25,
      autonomy: "guarded",
      baseBranch: "main",
    });
  });

  test("walks the phases in order and stops at deliver, waiting for the user", () => {
    expect(ofType("squad.phase_changed").map((e) => e.data.phase)).toEqual([
      "planning",
      "review",
      "foundation",
      "build",
      "verify",
      "deliver",
    ]);
    expect(ofType("squad.delivered")).toHaveLength(0);
    const looped = squadRun(1, 1, first.next).events.map((t) => t.event);
    const delivered = looped.filter((e) => e.type === "squad.delivered");
    expect(delivered).toHaveLength(1);
    expect(looped.at(-1)).toMatchObject({ type: "squad.phase_changed", data: { phase: "done" } });
  });

  test("the planner's first plan is rejected; the second is the one approved", () => {
    const proposed = ofType("plan.proposed");
    expect(proposed.map((e) => e.data.attempt)).toEqual([1, 2]);
    const rejected = ofType("plan.rejected");
    expect(rejected.map((e) => e.data.attempt)).toEqual([1]);
    // The rejection carries exactly what validatePlan says about the first proposal.
    expect(rejected[0]!.data.errors).toEqual(
      validatePlan(proposed[0]!.data.plan).map((i) => i.message),
    );
    expect(rejected[0]!.data.errors.length).toBeGreaterThan(0);
    expect(proposed[0]!.data.plan).not.toEqual(SAMPLE_SQUAD_PLAN);
    expect(proposed[1]!.data.plan).toEqual(SAMPLE_SQUAD_PLAN);
    expect(ofType("plan.approved")[0]!.data.plan).toEqual(proposed[1]!.data.plan);
    const order = (e: GravitaEvent) => events.indexOf(e);
    expect(order(rejected[0]!)).toBeLessThan(order(proposed[1]!));
    expect(order(proposed[1]!)).toBeLessThan(order(ofType("plan.approved")[0]!));
  });

  test("task statuses follow legal transitions and every task ends done", () => {
    const status = new Map<string, TaskStatus>();
    const attempt = new Map<string, number>();
    for (const e of ofType("task.status_changed")) {
      const { taskId, status: next } = e.data;
      const prev = status.get(taskId) ?? "pending";
      expect({ taskId, prev, next, legal: LEGAL[prev].includes(next) }).toMatchObject({
        legal: true,
      });
      expect(e.data.attempt).toBeGreaterThanOrEqual(attempt.get(taskId) ?? 1);
      const planned = SAMPLE_SQUAD_PLAN.tasks.find((t) => t.id === taskId)!;
      expect(e.data.role).toBe(planned.role);
      status.set(taskId, next);
      attempt.set(taskId, e.data.attempt);
    }
    expect([...status.keys()].sort()).toEqual(SAMPLE_SQUAD_PLAN.tasks.map((t) => t.id).sort());
    expect([...status.values()].every((s) => s === "done")).toBe(true);
    expect(attempt.get("web-client")).toBe(2);
    expect(attempt.get("api-routes")).toBe(2);
  });

  test("role sessions carry their squad, role and task, in the role's worktree", () => {
    // The planner, eleven task runs (nine tasks, two of them twice) and the final checks.
    expect(started.length).toBe(13);
    for (const e of started) {
      expect(e.data.kind).toBe("squad");
      expect(e.data.squadId).toBe(squadId);
      expect(["planner", "backend", "frontend", "tests"]).toContain(e.data.roleId!);
      if (e.data.roleId === "planner") {
        expect(e.data.cwd).toBe(DEMO_PROJECTS.todo.root);
        continue;
      }
      expect(e.data.cwd).toBe(
        `/Users/demo/.gravita/worktrees/todo-app/${squadId}/${e.data.roleId}`,
      );
      expect(e.data.gitBranch).toBe(`gravita/${squadId}/${e.data.roleId}`);
    }
    for (const e of ofType("task.status_changed")) {
      if (e.data.status !== "running") continue;
      const s = sessionsById.get(e.data.sessionId!)!;
      expect(s.data).toMatchObject({ roleId: e.data.role, taskId: e.data.taskId });
    }
    // Only the final-checks session has no task.
    const taskless = started.filter((e) => e.data.roleId !== "planner" && !e.data.taskId);
    expect(taskless).toHaveLength(1);
    expect(taskless[0]!.data.roleId).toBe("tests");
  });

  test("roles only write inside their paths, except the one ownership violation", () => {
    const violations = ofType("ownership.violation");
    expect(violations).toHaveLength(1);
    expect(violations[0]!.data).toMatchObject({
      role: "frontend",
      taskId: "web-client",
      attempt: 1,
      paths: ["apps/api/src/types.ts"],
    });
    const outside: string[] = [];
    for (const e of events) {
      if (e.type !== "tool.completed" || !e.data.fileChanges) continue;
      const s = sessionsById.get(e.sessionId!)!;
      const role = SAMPLE_SQUAD_PLAN.roles.find((r) => r.id === s.data.roleId)!;
      for (const c of e.data.fileChanges) {
        const rel = c.path.slice(s.data.cwd.length + 1);
        if (!role.owns.some((o) => within(rel, o))) outside.push(`${role.id}:${rel}`);
      }
    }
    expect(outside).toEqual(["frontend:apps/api/src/types.ts"]);
  });

  test("tells the build's incidents: a conflict, a note, a change request, the budget", () => {
    const idx = (e: GravitaEvent | undefined) => events.indexOf(e!);
    const conflict = ofType("merge.conflicted");
    expect(conflict.map((e) => [e.data.taskId, e.data.attempt])).toEqual([["api-routes", 1]]);
    const merged = ofType("merge.succeeded").find((e) => e.data.taskId === "api-routes")!;
    expect(merged.data.attempt).toBe(2);
    expect(idx(conflict[0])).toBeLessThan(idx(merged));

    expect(ofType("note.posted").map((e) => [e.data.fromRole, e.data.toRole])).toEqual([
      ["frontend", "backend"],
    ]);
    const opened = ofType("change_request.opened");
    const resolved = ofType("change_request.resolved");
    expect(opened).toHaveLength(1);
    expect(resolved.map((e) => e.data)).toEqual([
      { squadId, requestId: opened[0]!.data.requestId, outcome: "done" },
    ]);
    expect(idx(opened[0])).toBeLessThan(idx(resolved[0]));

    const frozen = ofType("contract.frozen");
    expect(frozen.map((e) => [e.data.path, e.data.version])).toEqual([
      ["packages/contracts/openapi.yaml", 1],
    ]);
    const contractsCommit = ofType("commit.created").find((e) => e.data.taskId === "contracts")!;
    expect(frozen[0]!.data.sha).toBe(contractsCommit.data.sha);
    const build = ofType("squad.phase_changed").find((e) => e.data.phase === "build")!;
    expect(idx(frozen[0])).toBeLessThan(idx(build));

    const warned = ofType("budget.warned");
    expect(warned).toHaveLength(1);
    expect(warned[0]!.data).toMatchObject({ scope: "squad", scopeId: squadId, limitUsd: 25 });
    expect(warned[0]!.data.usedUsd).toBeGreaterThanOrEqual(SQUAD_BUDGET_USD * 0.75);
    expect(ofType("budget.exhausted")).toHaveLength(0);
    const total = ofType("cost.snapshot").reduce((sum, e) => sum + e.data.totalCostUsd, 0);
    expect(total).toBeLessThan(SQUAD_BUDGET_USD);

    const checks = ofType("check.ran");
    expect(checks.every((e) => e.data.ok)).toBe(true);
    const verify = ofType("squad.phase_changed").find((e) => e.data.phase === "verify")!;
    const finals = checks.filter((e) => e.data.runId === "final");
    expect(finals.map((e) => e.data.checkId)).toEqual(["unit", "build", "e2e"]);
    for (const e of finals) expect(idx(e)).toBeGreaterThan(idx(verify));
  });

  test("projects through the core reducer: the squad waits at deliver, its sessions ended", () => {
    const state = applyAll(emptyState(), events);
    const squad = state.squads?.[squadId];
    expect(squad?.phase).toBe("deliver");
    expect(Object.values(squad?.tasks ?? {}).every((t) => t.status === "done")).toBe(true);
    expect(squad?.sessionIds).toHaveLength(started.length);
    const sessions = started.map((e) => state.sessions[e.sessionId!]!);
    for (const s of sessions) {
      expect(s.kind).toBe("squad");
      expect(s.ended).toBe(true);
      expect(s.agents.main!.toolCount).toBeGreaterThan(0);
    }
    const withSubagents = sessions.filter((s) => Object.keys(s.agents).length > 1);
    expect(withSubagents.length).toBeGreaterThanOrEqual(2);
  });

  test("plays in the demo timeline, a little after the other stories", () => {
    const all = scenarioEvents({ seed: 1, now: () => 0 }, 200_000);
    const todo = all.filter((e) => e.projectId === DEMO_PROJECTS.todo.id);
    expect(todo[0]!.type).toBe("project.discovered");
    const created = todo.find((e) => e.type === "squad.created")!;
    expect(Date.parse(created.ts)).toBe(SQUAD_START_MS);
    expect(todo.some((e) => e.type === "squad.phase_changed" && e.data.phase === "deliver")).toBe(
      true,
    );
  });
});
