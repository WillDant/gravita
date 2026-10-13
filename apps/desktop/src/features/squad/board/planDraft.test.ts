import { validatePlan } from "@gravita/core";
import { describe, expect, it } from "vitest";
import { PLAN } from "@/test/squadFixtures";
import { answersFor, editTask, moveTask, pinIssues, removeTask } from "./planDraft";

describe("plan edits on the Board", () => {
  it("rewrites a task's title and summary", () => {
    const p = editTask(PLAN, "api-store", { title: "Storage", plainSummary: "Keeps todos." });
    expect(p.tasks.find((t) => t.id === "api-store")).toMatchObject({
      title: "Storage",
      plainSummary: "Keeps todos.",
    });
    expect(PLAN.tasks.find((t) => t.id === "api-store")?.title).toBe("Todo storage");
  });

  it("removes a task and the dependencies on it", () => {
    const r = removeTask(PLAN, "web-shell");
    expect(r.plan.tasks.some((t) => t.id === "web-shell")).toBe(false);
    expect(r.unblocked).toEqual(["web-todos"]);
    expect(r.plan.tasks.find((t) => t.id === "web-todos")?.dependsOn).toEqual([]);
    expect(validatePlan(r.plan)).toEqual([]);
  });

  it("moves a task only where its paths are owned", () => {
    expect(moveTask(PLAN, "web-todos", "backend")).toEqual({
      ok: false,
      outside: ["apps/web/src/components/"],
    });
    const plan = {
      ...PLAN,
      roles: PLAN.roles.map((r) => (r.id === "tests" ? { ...r, owns: [...r.owns, "docs/"] } : r)),
      tasks: [
        ...PLAN.tasks,
        {
          ...PLAN.tasks[0]!,
          id: "docs",
          role: "backend",
          writes: ["docs/"],
          foundation: false,
          dependsOn: [],
        },
      ],
    };
    const moved = moveTask(plan, "docs", "tests");
    expect(moved.ok && moved.plan.tasks.find((t) => t.id === "docs")?.role).toBe("tests");
  });

  it("pins each issue to the task, role or check its path names", () => {
    const bad = {
      ...PLAN,
      tasks: PLAN.tasks.map((t) => (t.id === "tests-api" ? { ...t, writes: ["apps/api/x/"] } : t)),
    };
    const pinned = pinIssues(bad, validatePlan(bad));
    expect([...pinned.tasks.keys()]).toEqual(["tests-api"]);
    expect(pinned.general).toEqual([]);
  });

  it("sends only the answers the user gave", () => {
    expect(answersFor(["a?", "b?"], { "a?": " yes ", "b?": "  " })).toEqual({ "a?": "yes" });
  });
});
