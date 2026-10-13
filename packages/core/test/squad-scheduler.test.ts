import { describe, expect, test } from "bun:test";
import type { PlanTask, SquadPlan, TaskStatus } from "@gravita/protocol";
import fc from "fast-check";
import { isComplete, nextTasks, squadProgress, type TaskRun } from "../src";
import { samplePlan } from "./squad-fixture";

const STATUSES: TaskStatus[] = [
  "pending",
  "ready",
  "running",
  "blocked",
  "review",
  "done",
  "failed",
  "skipped",
];
const settled = (s: TaskStatus | undefined) => s === "done" || s === "skipped";
const busy = (s: TaskStatus | undefined) => s === "running" || s === "review";

/** Random acyclic plans: deps point at earlier tasks; foundation only on foundation. */
const arbPlan: fc.Arbitrary<SquadPlan> = fc
  .tuple(
    fc.integer({ min: 1, max: 4 }),
    fc.array(
      fc.record({
        role: fc.nat(),
        foundation: fc.boolean(),
        deps: fc.array(fc.nat(), { maxLength: 3 }),
      }),
      { minLength: 1, maxLength: 10 },
    ),
  )
  .map(([roleCount, specs]) => {
    const base = samplePlan();
    const roles = Array.from({ length: roleCount }, (_, i) => ({
      id: `r${i}`,
      name: `R${i}`,
      kind: "custom" as const,
      owns: [`pkg/r${i}/`],
      charter: "",
    }));
    const tasks: PlanTask[] = [];
    specs.forEach((spec, i) => {
      const earlier = tasks.filter((t) => !spec.foundation || t.foundation);
      const deps =
        earlier.length === 0
          ? []
          : [...new Set(spec.deps.map((d) => earlier[d % earlier.length]!.id))];
      tasks.push({
        id: `t${i}`,
        role: `r${spec.role % roleCount}`,
        title: `T${i}`,
        plainSummary: "x",
        dependsOn: deps,
        writes: [`pkg/r${spec.role % roleCount}/x`],
        acceptance: ["x"],
        size: "s",
        ...(spec.foundation ? { foundation: true } : {}),
      });
    });
    return { ...base, roles, tasks, contracts: [] };
  });

const arbCase = arbPlan.chain((plan) =>
  fc.tuple(
    fc.constant(plan),
    fc.array(fc.constantFrom(...STATUSES), {
      minLength: plan.tasks.length,
      maxLength: plan.tasks.length,
    }),
    fc.integer({ min: 1, max: 4 }),
  ),
);

function runs(plan: SquadPlan, statuses: TaskStatus[]): Record<string, TaskRun> {
  return Object.fromEntries(
    plan.tasks.map((t, i) => [t.id, { status: statuses[i]!, role: t.role }]),
  );
}

describe("nextTasks properties", () => {
  test("respects roles, dependencies, the role cap and foundation-first", () => {
    fc.assert(
      fc.property(arbCase, ([plan, statuses, maxRoles]) => {
        const tasks = runs(plan, statuses);
        const start = nextTasks(plan, tasks, { maxRoles });
        const byId = new Map(plan.tasks.map((t) => [t.id, t]));
        const busyBefore = new Set(
          plan.tasks.filter((t) => busy(tasks[t.id]!.status)).map((t) => t.role),
        );
        const startedRoles = start.map((id) => tasks[id]!.role);

        // At most one task in flight per role.
        expect(new Set(startedRoles).size).toBe(startedRoles.length);
        for (const r of startedRoles) expect(busyBefore.has(r)).toBe(false);
        // Never more than maxRoles roles busy (nothing new starts once the cap is hit).
        if (busyBefore.size >= maxRoles) expect(start).toEqual([]);
        else expect(busyBefore.size + startedRoles.length).toBeLessThanOrEqual(maxRoles);

        const foundationOpen = plan.tasks.some(
          (t) => t.foundation && !settled(tasks[t.id]!.status),
        );
        for (const id of start) {
          const t = byId.get(id)!;
          expect(["pending", "ready"]).toContain(tasks[id]!.status);
          for (const d of t.dependsOn) expect(settled(tasks[d]!.status)).toBe(true);
          if (foundationOpen) expect(t.foundation).toBe(true);
        }
        // Plan order.
        const order = start.map((id) => plan.tasks.findIndex((t) => t.id === id));
        expect(order).toEqual([...order].sort((a, b) => a - b));
      }),
      { numRuns: 500 },
    );
  });

  test("finishing whatever starts always completes an acyclic plan", () => {
    fc.assert(
      fc.property(arbPlan, fc.integer({ min: 1, max: 4 }), (plan, maxRoles) => {
        const tasks: Record<string, TaskRun> = {};
        for (let round = 0; round <= plan.tasks.length; round++) {
          const start = nextTasks(plan, tasks, { maxRoles });
          if (start.length === 0) break;
          for (const id of start) {
            const t = plan.tasks.find((x) => x.id === id)!;
            tasks[id] = { status: "done", role: t.role };
          }
        }
        expect(isComplete(plan, tasks)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});

describe("nextTasks examples", () => {
  const plan = samplePlan();

  test("foundation first, then build tasks in parallel across roles", () => {
    expect(nextTasks(plan, {})).toEqual(["api-contract"]);
    const afterFoundation: Record<string, TaskRun> = {
      "api-contract": { status: "done", role: "backend" },
    };
    expect(nextTasks(plan, afterFoundation)).toEqual(["api-todos", "web-list"]);
    expect(nextTasks(plan, afterFoundation, { maxRoles: 1 })).toEqual(["api-todos"]);
  });

  test("a busy role gets nothing; a skipped foundation unblocks the build", () => {
    expect(
      nextTasks(plan, {
        "api-contract": { status: "skipped", role: "backend" },
        "api-todos": { status: "review", role: "backend" },
      }),
    ).toEqual(["web-list"]);
    expect(nextTasks(plan, { "api-contract": { status: "failed", role: "backend" } })).toEqual([]);
  });

  test("a reassigned task counts against its new role", () => {
    expect(
      nextTasks(plan, {
        "api-contract": { status: "done", role: "backend" },
        "api-todos": { status: "pending", role: "frontend" },
        "web-list": { status: "running", role: "frontend" },
      }),
    ).toEqual([]);
  });

  test("progress and completion", () => {
    const tasks: Record<string, TaskRun> = {
      "api-contract": { status: "done", role: "backend" },
      "api-todos": { status: "running", role: "backend" },
      "web-list": { status: "blocked", role: "frontend" },
    };
    expect(squadProgress(plan, tasks)).toEqual({
      done: 1,
      total: 3,
      failed: 0,
      running: 1,
      blocked: 1,
    });
    expect(isComplete(plan, tasks)).toBe(false);
    tasks["api-todos"]!.status = "done";
    tasks["web-list"]!.status = "skipped";
    expect(isComplete(plan, tasks)).toBe(true);
  });
});
