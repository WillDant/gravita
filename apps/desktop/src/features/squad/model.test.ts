import { describe, expect, it } from "vitest";
import { PLAN, SQ, squadFixture } from "@/test/squadFixtures";
import { squadView, taskOrder } from "./model";

describe("squad view", () => {
  it("orders tasks foundation first, each after what it waits for", () => {
    const order = taskOrder(PLAN);
    expect(order.slice(0, 2)).toEqual(["scaffold-api", "contracts"]);
    for (const t of PLAN.tasks)
      for (const d of t.dependsOn) expect(order.indexOf(d)).toBeLessThan(order.indexOf(t.id));
  });

  it("reads roles with spend and tasks with where they stand", () => {
    const { state } = squadFixture("run");
    const q = state.squads[SQ];
    if (!q) throw new Error("fixture");
    const view = squadView(state, q);
    expect(view.roles.map((r) => r.id)).toEqual(["backend", "frontend", "tests"]);
    expect(view.role("backend")?.spentUsd).toBeCloseTo(3.7);
    expect(view.task("tests-api")).toMatchObject({ status: "blocked", attempt: 2 });
    expect(view.task("tests-api")?.merge?.state).toBe("conflicted");
    expect(view.planner?.sessionId).toBe("s-planner");
  });
});
