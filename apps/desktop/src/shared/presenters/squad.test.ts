import { agentColor } from "@gravita/orbs";
import { describe, expect, it } from "vitest";
import { applyEvents } from "@/state/applyEvents";
import { ev, NOW, started, stateOf } from "@/test/events";
import { PROJECT, SQ, squadFixture } from "@/test/squadFixtures";
import {
  needsYouCount,
  pauseKind,
  phaseStop,
  projectItems,
  roleColorKey,
  squadDecisions,
  squadNeedsYou,
  squadTitle,
} from "./squad";

describe("squad presenters", () => {
  it("folds a squad's sessions into one row of its project", () => {
    const { state } = squadFixture("run");
    const project = state.projects[PROJECT];
    if (!project) throw new Error("fixture");
    const items = projectItems(state, project);
    expect(items.filter((i) => i.kind === "squad")).toHaveLength(1);
    expect(items.filter((i) => i.kind === "session")).toEqual([]);
    const row = items[0];
    expect(row?.kind === "squad" && row.sessions.map((s) => s.id).sort()).toEqual([
      "s-b1",
      "s-b2",
      "s-f1",
      "s-planner",
      "s-t1",
    ]);
  });

  it("drops removed sessions from project rows", () => {
    const both = stateOf([...started("chat-1", 1, PROJECT, "chat")]);
    both.sessions["chat-1"]!.removed = true;
    const items = projectItems(both, both.projects[PROJECT]!);
    expect(items).toEqual([]);
  });

  it("keeps plain sessions as their own rows next to the squad", () => {
    const { state } = squadFixture("brief");
    const both = stateOf([...started("chat-1", 1, PROJECT, "chat")]);
    const merged = applyEvents(state, []);
    Object.assign(merged.sessions, both.sessions);
    merged.projects[PROJECT]?.sessionIds.push("chat-1");
    const items = projectItems(merged, merged.projects[PROJECT]!);
    expect(items.map((i) => i.kind).sort()).toEqual(["session", "squad"]);
  });

  it("names a squad by the first line of its brief", () => {
    const { state } = squadFixture("brief");
    expect(squadTitle(state.squads[SQ]!)).toBe(
      "Build a small todo app: API with Hono, web UI with React, tests with Vitest.",
    );
  });

  it("counts stuck tasks, a plan to review and a used-up budget as waiting on you", () => {
    expect(squadDecisions(squadFixture("review").state.squads[SQ]!)).toEqual([{ kind: "review" }]);
    expect(squadDecisions(squadFixture("run").state.squads[SQ]!)).toEqual([
      expect.objectContaining({ kind: "task", taskId: "tests-api", status: "blocked" }),
    ]);
    const budget = squadFixture("budget").state;
    expect(pauseKind(budget.squads[SQ]!)).toBe("budget");
    expect(squadNeedsYou(budget).map((d) => d.decision.kind)).toEqual(["paused", "task"]);
    expect(needsYouCount(budget, NOW)).toBeGreaterThanOrEqual(2);
  });

  it("gives custom roles pool hues no built-in role of the plan uses, in plan order", () => {
    const plan = {
      roles: [
        { id: "backend", kind: "backend" as const },
        { id: "docs", kind: "custom" as const },
        { id: "tests", kind: "tests" as const },
        { id: "infra", kind: "custom" as const },
      ],
    };
    const keys = plan.roles.map((r) => roleColorKey(r, plan));
    // Backend takes sky and tests take green: docs and infra get rose and orchid.
    expect(keys).toEqual(["backend", "role-rose", "tests", "role-orchid"]);
    expect(new Set(keys.map((k) => agentColor(k).line)).size).toBe(4);
    // With backend and frontend both present, orchid is first; then what stays free.
    const full = {
      roles: [
        { id: "backend", kind: "backend" as const },
        { id: "frontend", kind: "frontend" as const },
        { id: "a", kind: "custom" as const },
        { id: "b", kind: "custom" as const },
        { id: "c", kind: "custom" as const },
        { id: "d", kind: "custom" as const },
      ],
    };
    expect(full.roles.slice(2).map((r) => roleColorKey(r, full))).toEqual([
      "role-orchid",
      "role-mustard",
      "role-green",
      "role-rose",
    ]);
    // All five built-in kinds present: orchid, then the look-alikes, before any repeat.
    const crowded = {
      roles: [
        ...(["backend", "frontend", "design", "tests"] as const).map((kind) => ({
          id: kind,
          kind,
        })),
        { id: "docs", kind: "custom" as const },
        { id: "infra", kind: "custom" as const },
      ],
    };
    expect(crowded.roles.slice(4).map((r) => roleColorKey(r, crowded))).toEqual([
      "role-orchid",
      "role-rose",
    ]);
  });

  it("puts each phase on its stop of the line", () => {
    expect(phaseStop("planning")).toBe("plan");
    expect(phaseStop("review")).toBe("plan");
    expect(phaseStop("done")).toBe("deliver");
    expect(phaseStop("failed")).toBeUndefined();
  });

  it("re-renders a squad only when its batch touches it", () => {
    const { state } = squadFixture("run");
    const before = state.squads[SQ];
    const other = applyEvents(state, [
      ev("project.discovered", { root: "/x", name: "x" }, { projectId: "px" }),
    ]);
    expect(other.squads[SQ]).toBe(before);
    const touched = applyEvents(state, [
      ev("cost.snapshot", { totalCostUsd: 9 }, { projectId: PROJECT, sessionId: "s-b2" }),
    ]);
    expect(touched.squads[SQ]).not.toBe(before);
    expect(touched.squads[SQ]?.budget.spentUsd).toBeGreaterThan(before?.budget.spentUsd ?? 0);
    expect(before?.budget.spentUsd).toBe(state.squads[SQ]?.budget.spentUsd);
  });
});
