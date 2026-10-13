import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { SquadPlan } from "@gravita/protocol";
import { roleTools } from "../../src/application/squad/role-tools";
import { SquadRuns } from "../../src/application/squad/squad-run";
import { InvalidSquadPlanError, SquadPhaseError } from "../../src/domain/errors";
import { testPlan } from "../git-helpers";
import { withTempDir } from "../helpers";
import {
  type AgentScript,
  createAndPlan,
  type ScriptedAgent,
  squadCore,
  until,
} from "../squad-fakes";

// Squads under control: budgets, pause and resume, the kill switch, a restart, stop, and
// the user's task decisions. Scripted sessions, real git.

type Harness = ReturnType<typeof squadCore>;

const roleOf = (a: ScriptedAgent) => (a.cwd.endsWith("/backend") ? "backend" : "frontend");

/** Plans with `plan`, approves it and returns once the role sessions are running. */
async function building(h: Harness, tmp: string, budgetUsd = 20, sessions = 2, waitRunning = true) {
  const cwd = join(tmp, "app");
  await mkdir(cwd, { recursive: true });
  const { squadId } = await createAndPlan(h, {
    cwd,
    brief: "Demo",
    budgetUsd,
    autonomy: "guarded",
  });
  await h.squads.idle(squadId);
  await h.squads.approvePlan({ squadId, plan: h.squad(squadId).plan as SquadPlan });
  await until(() => h.agents.filter((a) => a.isRole).length >= sessions, "role sessions");
  if (waitRunning)
    await until(
      () =>
        Object.values(h.squad(squadId).tasks).filter((t) => t.status === "running").length >=
        sessions,
      "running tasks",
    );
  return { squadId, cwd };
}

/** Plans `plan`; role sessions run `role`. */
function script(role: AgentScript, plan: SquadPlan = testPlan()): AgentScript {
  return async (a) => {
    // The briefing says nothing: the test asks for the plan at once.
    if (a.isBriefing) return;
    if (a.isPlanner) return a.result({ structured: plan, cost: 0.1 });
    return role(a);
  };
}

/** Writes the task's file and completes it. */
async function work(a: ScriptedAgent, cost = 0.1) {
  const taskId = await a.taskId();
  await a.write({
    [`apps/${taskId.startsWith("api") ? "api" : "web"}/${taskId}.ts`]: `// ${taskId}\n`,
  });
  const done = await a.tool("complete_task", { summary: "Done." });
  if (done.isError) throw new Error(done.text);
  a.result({ cost });
}

const never = () => new Promise<void>(() => {});

/** A role session that reads its task and then works until it is stopped. */
const waitForever: AgentScript = async (a) => {
  await a.prompt(1);
  await never();
};

describe("budgets", () => {
  test("a squad out of budget interrupts every session (disposing a stuck one after 5 s), pauses, and goes on with a raised budget", async () => {
    await withTempDir(async (tmp) => {
      const h = squadCore(
        tmp,
        script(async (a) => {
          await a.prompt(1);
          if (a.options.resume) return work(a);
          if (roleOf(a) === "backend") return a.result({ cost: 2.5 });
          // The frontend's session ignores the interrupt: Gravita disposes it after the grace.
          a.onInterrupt = () => {};
          await never();
        }),
      );
      const { squadId } = await building(h, tmp, 2, 2, false);
      await until(() => h.squad(squadId).paused !== undefined, "pause");
      const q = h.squad(squadId);
      expect(q.paused?.reason).toBe("The squad's budget ($2.00) is used up.");
      expect(h.events("budget.exhausted").map((e) => e.data)).toEqual([
        { squadId, scope: "squad", scopeId: squadId, usedUsd: 2.6, limitUsd: 2 },
      ]);
      const frontend = h.agents.find((a) => a.isRole && roleOf(a) === "frontend");
      expect(frontend?.q.calls).toContain("interrupt");
      expect(h.core.runtimes.all()).toHaveLength(1);
      h.clock.advance(5_000);
      await h.squads.idle(squadId);
      expect(h.core.runtimes.all()).toHaveLength(0);
      // Both tasks go back to ready, to continue where they left off.
      expect(h.squad(squadId).tasks["api-1"]).toMatchObject({ status: "ready", attempt: 2 });
      expect(h.squad(squadId).tasks["web-1"]).toMatchObject({ status: "ready", attempt: 2 });
      expect(() => h.squads.resume({ squadId })).toThrow(
        "The squad's budget ($2.00) is used up; resume with a higher budget to go on.",
      );
      expect(() => h.squads.resume({ squadId, budgetUsd: 2.5 })).toThrow(
        "The new budget must be more than the $2.60 already spent.",
      );
      expect(() => h.squads.resume({ squadId, budgetUsd: 10, roleBudgets: { ops: 3 } })).toThrow(
        `"ops" isn't a role of this squad.`,
      );
      expect(() =>
        h.squads.resume({ squadId, budgetUsd: 10, roleBudgets: { backend: 1 } }),
      ).toThrow("backend's new budget must be more than the $2.50 it already spent.");

      h.squads.resume({ squadId, budgetUsd: 10, roleBudgets: { backend: 5 } });
      expect(h.events("squad.budget_changed").map((e) => e.data)).toEqual([
        { squadId, budgetUsd: 10, previousUsd: 2, roleBudgets: { backend: 5 } },
      ]);
      await h.squads.idle(squadId);
      expect(h.failures).toEqual([]);
      const q2 = h.squad(squadId);
      expect(q2).toMatchObject({ phase: "deliver", budgetUsd: 10, roleBudgets: { backend: 5 } });
      expect(q2.budget.exhausted).toEqual([]);
      // The resumed sessions share what is left: (10 - 2.6) / 2, and backend's (5 - 2.5).
      const resumed = h.agents.filter((a) => a.isRole && a.options.resume);
      expect(resumed.map((a) => [roleOf(a), a.options.maxBudgetUsd]).sort()).toEqual([
        ["backend", 2.5],
        ["frontend", 3.7],
      ]);
    });
  }, 20_000); // waits out the 5 s grace before a stuck session is disposed

  test("sessions running side by side share what is left of the squad budget", async () => {
    await withTempDir(async (tmp) => {
      const step = 0.5;
      const base = testPlan();
      const plan: SquadPlan = {
        ...base,
        roles: [
          ...base.roles,
          { id: "tests", name: "Tests", kind: "tests", owns: ["tests/"], charter: "" },
        ],
        tasks: [
          ...base.tasks,
          {
            id: "tests-1",
            role: "tests",
            title: "Tests",
            plainSummary: "Checks it.",
            dependsOn: [],
            writes: ["tests/"],
            acceptance: ["green"],
            size: "s",
          },
        ],
      };
      // Each session spends a response at a time until Claude Code stops it at its cap.
      const h = squadCore(tmp, async (a) => {
        // The briefing says nothing: the test asks for the plan at once.
        if (a.isBriefing) return;
        if (a.isPlanner) return a.result({ structured: plan });
        await a.prompt(1);
        const cap = a.options.maxBudgetUsd ?? 0;
        let cost = 0;
        while (cost <= cap) cost += step;
        a.result({ subtype: "error_max_budget_usd", cost });
      });
      const { squadId } = await building(h, tmp, 9, 3, false);
      await h.squads.idle(squadId);
      const sessions = h.agents.filter((a) => a.isRole);
      expect(sessions).toHaveLength(3);
      // Alone, each task's slice would be $4.50; side by side each gets a third of $9.
      for (const s of sessions) expect(s.options.maxBudgetUsd).toBe(3);
      const q = h.squad(squadId);
      // Together they overrun the squad by at most one response each.
      expect(q.budget.spentUsd).toBeLessThanOrEqual(9 + sessions.length * step);
      expect(q.paused?.reason).toBe("The squad's budget ($9.00) is used up.");
    });
  });

  test("75% of the squad budget warns once; a task out of its own budget is blocked", async () => {
    await withTempDir(async (tmp) => {
      const h = squadCore(
        tmp,
        script(async (a) => {
          await a.prompt(1);
          if (roleOf(a) === "backend")
            return a.result({ subtype: "error_max_budget_usd", cost: 4 });
          await work(a, 3.6);
        }),
      );
      const { squadId } = await building(h, tmp, 10, 2, false);
      await h.squads.idle(squadId);
      const q = h.squad(squadId);
      expect(q.tasks["api-1"]).toMatchObject({ status: "blocked", attempt: 1 });
      expect(q.tasks["api-1"]?.reason).toContain("used its budget");
      expect(q.tasks["web-1"]?.status).toBe("done");
      expect(h.events("budget.exhausted").map((e) => (e.data as { scope: string }).scope)).toEqual([
        "task",
      ]);
      expect(h.events("budget.warned").map((e) => (e.data as { scope: string }).scope)).toContain(
        "squad",
      );
      expect(q.paused).toBeUndefined();
      // Its slice (half the budget, with headroom: $7.50) is capped by its share of what's left.
      const backend = h.agents.find((a) => a.isRole && roleOf(a) === "backend");
      expect(backend?.options.maxBudgetUsd).toBe(4.95);
    });
  });
});

describe("pause, resume, the kill switch and stop", () => {
  test("pause interrupts; resume continues each task in its own session", async () => {
    await withTempDir(async (tmp) => {
      const h = squadCore(
        tmp,
        script(async (a) => {
          const first = await a.prompt(1);
          if (!a.options.resume) return never();
          expect(first).toContain("You were interrupted");
          await work(a);
        }),
      );
      const { squadId } = await building(h, tmp);
      const before = h.agents.filter((a) => a.isRole).map((a) => a.options.sessionId);
      h.squads.pause({ squadId });
      await h.squads.idle(squadId);
      expect(h.squad(squadId).paused?.reason).toBe("Paused by you.");
      expect(h.squad(squadId).tasks["api-1"]).toMatchObject({ status: "ready", attempt: 2 });
      expect(() => h.squads.pause({ squadId })).toThrow(SquadPhaseError);

      h.squads.resume({ squadId });
      await h.squads.idle(squadId);
      expect(h.failures).toEqual([]);
      const resumed = h.agents
        .filter((a) => a.isRole && a.options.resume)
        .map((a) => a.options.resume);
      expect(resumed.sort()).toEqual([...before].sort());
      expect(h.squad(squadId).phase).toBe("deliver");
      expect(h.squad(squadId).paused).toBeUndefined();
    });
  });

  test("the tray's kill switch stops the role sessions and pauses the squad instead of retrying", async () => {
    await withTempDir(async (tmp) => {
      const h = squadCore(tmp, script(waitForever));
      const { squadId } = await building(h, tmp);
      expect(await h.core.stopAll.execute()).toEqual({ stopped: 2 });
      await h.squads.idle(squadId);
      const q = h.squad(squadId);
      expect(q.paused?.reason).toContain("kill switch");
      expect(q.tasks["api-1"]).toMatchObject({ status: "ready", attempt: 2 });
      expect(q.tasks["web-1"]).toMatchObject({ status: "ready", attempt: 2 });
      // Nothing was restarted on its own.
      expect(h.agents.filter((a) => a.isRole)).toHaveLength(2);
      expect(h.events("squad.paused")).toHaveLength(1);
    });
  });

  test("stop closes every session, keeps the worktrees, and the squad is over", async () => {
    await withTempDir(async (tmp) => {
      const h = squadCore(tmp, script(waitForever));
      const { squadId } = await building(h, tmp);
      await h.squads.stop({ squadId });
      await h.squads.idle(squadId);
      expect(h.squad(squadId).phase).toBe("stopped");
      expect(h.core.runtimes.all()).toHaveLength(0);
      expect(h.squad(squadId).paused).toBeUndefined();
      expect(existsSync(join(tmp, "data", "worktrees", "p1", squadId, "backend"))).toBe(true);
      await expect(h.squads.stop({ squadId })).rejects.toThrow(SquadPhaseError);
      expect(() => h.squads.resume({ squadId })).toThrow(SquadPhaseError);
    });
  });

  test("after a restart, working squads wait paused and their tasks run again on resume", async () => {
    await withTempDir(async (tmp) => {
      const dbPath = join(tmp, "gravita.db");
      const first = squadCore(tmp, script(waitForever), { dbPath });
      const { squadId } = await building(first, tmp);
      const sessions = first.agents.filter((a) => a.isRole).map((a) => a.options.sessionId);

      // The engine "crashes": a new one opens the same database.
      const second = squadCore(
        tmp,
        script(async (a) => {
          await a.prompt(1);
          await work(a);
        }),
        { dbPath },
      );
      second.squads.recover();
      second.squads.recover();
      const q = second.squad(squadId);
      expect(q.paused?.reason).toContain("Gravita restarted");
      expect(q.tasks["api-1"]).toMatchObject({ status: "ready", attempt: 2 });
      expect(q.tasks["web-1"]).toMatchObject({ status: "ready", attempt: 2 });
      expect(second.events("squad.paused")).toHaveLength(1);
      expect(second.agents).toHaveLength(0);

      second.squads.resume({ squadId });
      await second.squads.idle(squadId);
      expect(second.failures).toEqual([]);
      expect(second.squad(squadId).phase).toBe("deliver");
      expect(second.agents.map((a) => a.options.resume).sort()).toEqual([...sessions].sort());

      first.squads.close();
      await first.core.disposeRuntimes(100);
    });
  });
});

describe("tasks: retries and the user's decisions", () => {
  test("an error is retried once by itself, then waits for the user: retry, skip, reassign", async () => {
    await withTempDir(async (tmp) => {
      let backendRuns = 0;
      const h = squadCore(
        tmp,
        script(async (a) => {
          await a.prompt(1);
          if (roleOf(a) === "frontend") {
            await a.tool("yield_blocked", { reason: "Which colour?" });
            return a.result();
          }
          backendRuns++;
          if (backendRuns <= 2)
            return a.result({ subtype: "error_during_execution", errors: ["boom"] });
          await work(a);
        }),
      );
      const { squadId } = await building(h, tmp, 20, 2, false);
      await h.squads.idle(squadId);
      let q = h.squad(squadId);
      expect(backendRuns).toBe(2);
      expect(q.tasks["api-1"]).toMatchObject({ status: "failed", attempt: 2, reason: "boom" });
      expect(q.tasks["web-1"]).toMatchObject({
        status: "blocked",
        reason: "Needs you: Which colour?",
      });
      expect(() => h.squads.reassignTask({ squadId, taskId: "web-1", role: "backend" })).toThrow(
        InvalidSquadPlanError,
      );

      h.squads.retryTask({ squadId, taskId: "api-1", model: "sonnet" });
      await h.squads.idle(squadId);
      q = h.squad(squadId);
      expect(q.tasks["api-1"]).toMatchObject({ status: "done", attempt: 3 });
      expect(h.agents.at(-1)?.options.model).toBe("sonnet");
      expect(() => h.squads.retryTask({ squadId, taskId: "api-1" })).toThrow(SquadPhaseError);

      h.squads.skipTask({ squadId, taskId: "web-1" });
      await h.squads.idle(squadId);
      q = h.squad(squadId);
      expect(q.tasks["web-1"]?.status).toBe("skipped");
      expect(q.phase).toBe("deliver");
    });
  });

  test("a red integration check undoes the merge and the task runs again with the output", async () => {
    await withTempDir(async (tmp) => {
      const plan: SquadPlan = {
        ...testPlan(),
        checks: [
          {
            id: "no-broken",
            argv: ["node", "-e", "process.exit(require('fs').existsSync('apps/api/BROKEN')?1:0)"],
            cwd: ".",
            when: "integration",
          },
        ],
      };
      const prompts: string[] = [];
      const h = squadCore(
        tmp,
        script(async (a) => {
          const prompt = await a.prompt(1);
          if (roleOf(a) === "backend") {
            prompts.push(prompt);
            if (prompts.length === 1) await a.write({ "apps/api/BROKEN": "x\n" });
            else await rm(join(a.cwd, "apps/api/BROKEN"));
          }
          await work(a);
        }, plan),
      );
      const { squadId } = await building(h, tmp, 20, 1, false);
      await h.squads.idle(squadId);
      const q = h.squad(squadId);
      expect(h.failures).toEqual([]);
      expect(q.merges["api-1:1"]?.state).toBe("reverted");
      expect(q.merges["api-1:2"]?.state).toBe("succeeded");
      expect(q.tasks["api-1"]).toMatchObject({ status: "done", attempt: 2 });
      expect(prompts[1]).toContain("The no-broken check failed after the merge");
      expect(q.phase).toBe("deliver");
    });
  });

  test("the third ownership violation in a run fails the task", async () => {
    await withTempDir(async (tmp) => {
      const replies: string[] = [];
      const h = squadCore(
        tmp,
        script(async (a) => {
          await a.prompt(1);
          if (roleOf(a) === "frontend") return work(a);
          await a.write({ "apps/web/mine-now.ts": "x\n" });
          for (let i = 0; i < 3; i++)
            replies.push((await a.tool("complete_task", { summary: "x" })).text);
          a.result();
        }),
      );
      const { squadId } = await building(h, tmp, 20, 2, false);
      await h.squads.idle(squadId);
      const q = h.squad(squadId);
      expect(q.tasks["api-1"]?.status).toBe("failed");
      expect(q.violations.map((v) => v.bounce ?? 1)).toEqual([1, 2, 3]);
      expect(replies[0]).toContain("apps/web/mine-now.ts");
      expect(replies[2]).toContain("the task has failed");
      expect(q.commits.some((c) => c.taskId === "api-1")).toBe(false);
    });
  });
});

describe("role tools are bound to their session", () => {
  test("no tool takes a role or a task to act for", () => {
    const calls: string[] = [];
    const host = new Proxy(
      {},
      {
        get: (_t, name) => (b: { roleId: string; taskId: string }) => {
          calls.push(`${String(name)}:${b.roleId}:${b.taskId}`);
          return { text: "ok" };
        },
      },
    );
    const tools = roleTools(host as never, {
      squadId: "q1",
      roleId: "frontend",
      taskId: "web-1",
      attempt: 1,
    });
    expect(tools.map((t) => t.name)).toEqual([
      "whoami",
      "get_brief",
      "get_task",
      "list_tasks",
      "report_progress",
      "complete_task",
      "yield_blocked",
      "post_note",
      "read_notes",
      "read_contract",
      "propose_contract_change",
      "request_change",
      "report_bug",
      "get_integration_status",
    ]);
    for (const t of tools) {
      expect(Object.keys(t.input)).not.toContain("roleId");
      expect(Object.keys(t.input)).not.toContain("role");
      expect(Object.keys(t.input)).not.toContain("squadId");
    }
    void Promise.all(tools.map((t) => t.handler({ summary: "s", text: "t", toRole: "backend" })));
    expect(calls.every((c) => c.endsWith(":frontend:web-1"))).toBe(true);
  });

  test("a binding only reaches its own live attempt", () => {
    const runs = new SquadRuns("/data/worktrees");
    const run = runs.of({ id: "q1", projectId: "p1" });
    run.active.set("web-1", {
      squadId: "q1",
      projectId: "p1",
      roleId: "frontend",
      taskId: "web-1",
      attempt: 2,
      worktree: "/w",
      roleBranch: "b",
      integrationBranch: "i",
      maxBudgetUsd: 1,
      bounces: 0,
      progressCount: 0,
    });
    const b = { squadId: "q1", taskId: "web-1" };
    expect(runs.attempt({ ...b, roleId: "frontend", attempt: 2 })?.attempt).toBe(2);
    expect(runs.attempt({ ...b, roleId: "frontend", attempt: 1 })).toBeUndefined();
    expect(runs.attempt({ ...b, roleId: "backend", attempt: 2 })).toBeUndefined();
  });
});
