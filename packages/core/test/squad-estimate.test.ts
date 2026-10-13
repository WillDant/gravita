import { describe, expect, test } from "bun:test";
import { estimatePlanCost, modelFamily, PRICES } from "../src";
import { samplePlan } from "./squad-fixture";

describe("estimatePlanCost", () => {
  const plan = samplePlan();
  const est = (m: string) => estimatePlanCost(plan, { planner: m, roles: m });

  test("opus costs more than sonnet, which costs more than haiku", () => {
    expect(est("claude-opus-5-5").totalUsd).toBeGreaterThan(est("claude-sonnet-5-5").totalUsd);
    expect(est("Sonnet").totalUsd).toBeGreaterThan(est("haiku").totalUsd);
  });

  test("byRole sums to the total minus the planner run, byTask to the same", () => {
    const e = est("opus");
    const roles = Object.values(e.byRole).reduce((a, b) => a + b, 0);
    const tasks = Object.values(e.byTask).reduce((a, b) => a + b, 0);
    expect(roles).toBeCloseTo(e.totalUsd - e.plannerUsd, 9);
    expect(tasks).toBeCloseTo(roles, 9);
    expect(e.byRole.planner).toBe(0);
    expect(Object.keys(e.byTask).sort()).toEqual(["api-contract", "api-todos", "web-list"]);
    // A large task costs more than a small one on the same model.
    expect(e.byTask["web-list"]!).toBeGreaterThan(e.byTask["api-contract"]!);
  });

  test("a role's own model overrides the squad's role model", () => {
    const p = structuredClone(plan);
    p.roles.find((r) => r.id === "frontend")!.model = "haiku";
    const e = estimatePlanCost(p, { planner: "opus", roles: "opus" });
    expect(e.byRole.frontend!).toBeLessThan(est("opus").byRole.frontend!);
    expect(e.byRole.backend).toBeCloseTo(est("opus").byRole.backend!, 9);
  });

  test("model strings map to a family; default and unknown price as sonnet", () => {
    expect(modelFamily("claude-opus-5-5")).toBe("opus");
    expect(modelFamily("HAIKU")).toBe("haiku");
    expect(modelFamily("default")).toBe("sonnet");
    expect(modelFamily("mystery-model")).toBe("sonnet");
    expect(est("default").totalUsd).toBeCloseTo(est("sonnet").totalUsd, 9);
    expect(PRICES.opus.output).toBeGreaterThan(PRICES.opus.input);
  });
});
