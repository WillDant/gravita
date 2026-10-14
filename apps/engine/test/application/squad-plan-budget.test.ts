import { describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { budgetState } from "@gravita/core";
import type { GravitaEvent, SquadPlan } from "@gravita/protocol";
import { RpcErrors } from "@gravita/protocol";
import type {
  PlanUsageReading,
  PlanUsageSource,
} from "../../src/application/ports/plan-usage-source";
import { EventBroadcaster } from "../../src/application/services/event-broadcaster";
import { PlanUsageMonitor } from "../../src/application/services/plan-usage-monitor";
import { ProjectionService } from "../../src/application/services/projection-service";
import { IngestEvents } from "../../src/application/usecases/ingest-events";
import { PlanUsageUnavailableError } from "../../src/domain/errors";
import {
  PLAN_BASELINE_POLL_MS,
  PLAN_TASK_CAP_MIN_USD,
  PLAN_USAGE_POLL_MS,
} from "../../src/domain/squad-policy";
import { toRpcError } from "../../src/interface/rpc/router";
import { FakeClock, MemoryEventStore, RecordingPublisher, SilentLogger } from "../fakes";
import { testPlan } from "../git-helpers";
import { withTempDir } from "../helpers";
import { API_KEY_USAGE, rateLimitEvent, usageAnswer } from "../sdk-fakes";
import { type AgentScript, type ScriptedAgent, squadCore, until } from "../squad-fakes";

// Squads whose budget is a share of the user's plan: the baseline at approval, the change
// since (warn at 75%, pause at 100%), a window reset mid-squad, resuming with a bigger
// share, the API-key refusal, and the monitor that reads plan usage through running
// sessions. Scripted sessions, real git.

type Harness = ReturnType<typeof squadCore>;

/** The 5-hour window resets at 15:00 the day the test clock runs (epoch seconds). */
const RESET_S = Date.parse("2026-10-12T15:00:00.000Z") / 1000;
const NEXT_RESET_S = Date.parse("2026-10-12T20:00:00.000Z") / 1000;
const PLAN_BUDGET = { mode: "plan", maxPercent: 20, window: "five_hour" } as const;

const roleOf = (a: ScriptedAgent) => (a.cwd.endsWith("/backend") ? "backend" : "frontend");
const never = () => new Promise<void>(() => {});

/** Writes the task's file and completes it. */
async function work(a: ScriptedAgent) {
  const taskId = await a.taskId();
  await a.write({
    [`apps/${taskId.startsWith("api") ? "api" : "web"}/${taskId}.ts`]: `// ${taskId}\n`,
  });
  const done = await a.tool("complete_task", { summary: "Done." });
  if (done.isError) throw new Error(done.text);
  a.result({ cost: 0.1 });
}

/** The planner reports the window at 30% (a rate limit event), then plans. */
function script(role: AgentScript, plan: SquadPlan = testPlan()): AgentScript {
  return async (a) => {
    if (a.isBriefing) return;
    if (a.isPlanner) {
      a.q.emit(rateLimitEvent(0.3, { resetsAt: RESET_S }));
      return a.result({ structured: plan, cost: 0.1 });
    }
    return role(a);
  };
}

async function approved(h: Harness, tmp: string, budget: unknown = PLAN_BUDGET) {
  const cwd = join(tmp, "app");
  await mkdir(cwd, { recursive: true });
  const { squadId } = await h.squads.create({
    cwd,
    brief: "Demo",
    budget: budget as typeof PLAN_BUDGET,
    autonomy: "guarded",
  });
  h.squads.plan({ squadId });
  await h.squads.idle(squadId);
  await h.squads.approvePlan({ squadId, plan: h.squad(squadId).plan as SquadPlan });
  return squadId;
}

const dataOf = (events: GravitaEvent[]) => events.map((e) => e.data);

describe("plan budgets", () => {
  test("the share counts the window's change since approval: 75% warns, 100% pauses and interrupts; a bigger share goes on", async () => {
    await withTempDir(async (tmp) => {
      let frontendStarted!: () => void;
      const bothRunning = new Promise<void>((r) => {
        frontendStarted = r;
      });
      const h = squadCore(
        tmp,
        script(async (a) => {
          await a.prompt(1);
          if (a.options.resume) return work(a);
          if (roleOf(a) === "frontend") {
            frontendStarted();
            return never();
          }
          await bothRunning;
          a.q.emit(
            rateLimitEvent(0.4, { resetsAt: RESET_S }), // 10 points: half the share
            rateLimitEvent(0.46, { resetsAt: RESET_S }), // 16: 80%, a warning
            rateLimitEvent(0.51, { resetsAt: RESET_S }), // 21: over the share
          );
          await never();
        }),
      );
      const squadId = await approved(h, tmp);
      // The baseline: the window's usage when the squad started building.
      expect(dataOf(h.events("budget.baseline"))).toEqual([
        {
          squadId,
          provider: "claude",
          window: "five_hour",
          round: 1,
          baseline: 30,
          carried: 0,
          current: 30,
          resetsAt: new Date(RESET_S * 1000).toISOString(),
        },
      ]);
      await until(() => h.squad(squadId).paused !== undefined, "pause");
      expect(h.squad(squadId).paused?.reason).toBe(
        "The squad used its share of your 5-hour window (20%).",
      );
      const level = { squadId, scope: "squad", scopeId: squadId, unit: "points", limit: 20 };
      expect(dataOf(h.events("budget.warned"))).toEqual([
        { ...level, used: 16, window: "five_hour", provider: "claude" },
      ]);
      expect(dataOf(h.events("budget.exhausted"))).toEqual([
        { ...level, used: 21, window: "five_hour", provider: "claude" },
      ]);
      // Every running session was interrupted.
      for (const a of h.agents.filter((x) => x.isRole)) expect(a.q.calls).toContain("interrupt");
      // No misleading dollar budget: each task got only a generous safety cap.
      for (const a of h.agents.filter((x) => x.isRole))
        expect(a.options.maxBudgetUsd).toBeGreaterThanOrEqual(PLAN_TASK_CAP_MIN_USD);
      await h.squads.idle(squadId);

      expect(() => h.squads.resume({ squadId })).toThrow(
        "The squad used its share (21 of 20%); resume with a bigger share to go on.",
      );
      expect(() => h.squads.resume({ squadId, maxPercent: 15 })).toThrow(
        "The new share must be more than the 21 points already used.",
      );
      expect(() => h.squads.resume({ squadId, budgetUsd: 50 })).toThrow(
        "This squad's budget is a share of your plan; raise the percent instead.",
      );
      h.squads.resume({ squadId, maxPercent: 40 });
      expect(dataOf(h.events("squad.budget_changed"))).toEqual([
        { squadId, maxPercent: 40, previousPercent: 20 },
      ]);
      // The count starts again from the window now; what was used is carried.
      expect(h.events("budget.baseline").at(-1)?.data).toMatchObject({
        round: 2,
        baseline: 51,
        carried: 21,
      });
      await h.squads.idle(squadId);
      expect(h.failures).toEqual([]);
      const q = h.squad(squadId);
      expect(q).toMatchObject({ phase: "deliver", budgetPlan: { maxPercent: 40 } });
      expect(q.budget.exhausted).toEqual([]);
    });
  });

  test("a window that resets mid-squad carries what was used and counts the new window from 0", async () => {
    await withTempDir(async (tmp) => {
      const h = squadCore(
        tmp,
        script(async (a) => {
          await a.prompt(1);
          if (a.options.resume || roleOf(a) === "frontend") return work(a);
          a.q.emit(
            rateLimitEvent(0.42, { resetsAt: RESET_S }), // 12 points
            rateLimitEvent(0.05, { resetsAt: NEXT_RESET_S }), // a new window: 12 + 5
          );
          await until(() => h.events("budget.baseline").length === 2, "the reset recorded");
          a.q.emit(rateLimitEvent(0.08, { resetsAt: NEXT_RESET_S })); // 20: the share
          await never();
        }),
      );
      const squadId = await approved(h, tmp);
      await until(() => h.squad(squadId).paused !== undefined, "pause");
      expect(h.events("budget.baseline").map((e) => e.data)).toMatchObject([
        { round: 1, baseline: 30, carried: 0 },
        { round: 2, baseline: 0, carried: 12, current: 5 },
      ]);
      expect(h.events("budget.exhausted").map((e) => (e.data as { used: number }).used)).toEqual([
        20,
      ]);
      await h.squads.idle(squadId);
    });
  });

  test("after a restart the points used are still known: a squad that used its share needs a bigger one", async () => {
    await withTempDir(async (tmp) => {
      const dbPath = join(tmp, "gravita.db");
      const first = squadCore(
        tmp,
        script(async (a) => {
          await a.prompt(1);
          if (roleOf(a) === "frontend") return never();
          a.q.emit(
            rateLimitEvent(0.4, { resetsAt: RESET_S }),
            rateLimitEvent(0.46, { resetsAt: RESET_S }),
            rateLimitEvent(0.51, { resetsAt: RESET_S }),
          );
          await never();
        }),
        { dbPath },
      );
      const squadId = await approved(first, tmp);
      await until(() => first.squad(squadId).paused !== undefined, "pause");
      await first.squads.idle(squadId);
      // Usage readings aren't stored; what the meter reached is.
      expect(dataOf(first.events("budget.measured"))).toEqual(
        [40, 46, 51].map((last) => ({
          squadId,
          provider: "claude",
          window: "five_hour",
          round: 1,
          last,
        })),
      );

      // The engine restarts on the same database: no usage reading is known.
      const second = squadCore(
        tmp,
        script(async (a) => {
          await a.prompt(1);
          await work(a);
        }),
        { dbPath },
      );
      second.clock.t = first.clock.t + 60_000;
      second.squads.recover();
      expect(second.core.projection.usage()).toEqual({});
      const q = second.squad(squadId);
      expect(budgetState(q, {})).toMatchObject({ spent: 21, limit: 20, measuring: false });
      expect(() => second.squads.resume({ squadId })).toThrow(
        "The squad used its share (21 of 20%); resume with a bigger share to go on.",
      );
      second.squads.resume({ squadId, maxPercent: 40 });
      expect(second.squad(squadId)).toMatchObject({ budgetPlan: { maxPercent: 40 } });
      expect(second.squad(squadId).paused).toBeUndefined();
      await second.squads.idle(squadId);
    });
  });

  test("a pause at start-up keeps what the meter reached since its last note", async () => {
    await withTempDir(async (tmp) => {
      const dbPath = join(tmp, "gravita.db");
      const first = squadCore(
        tmp,
        script(async (a) => {
          await a.prompt(1);
          if (roleOf(a) === "backend")
            a.q.emit(
              rateLimitEvent(0.4, { resetsAt: RESET_S }), // 10 points: noted
              rateLimitEvent(0.405, { resetsAt: RESET_S }), // half a point more: not yet
            );
          await never();
        }),
        { dbPath },
      );
      const squadId = await approved(first, tmp);
      await until(
        () => first.squad(squadId).budget.meters?.["claude:five_hour"]?.last === 40.5,
        "the readings",
      );
      expect(dataOf(first.events("budget.measured"))).toMatchObject([{ last: 40 }]);
      // The engine stops (nothing more is recorded) before anything paused the squad.
      first.squads.close();
      await first.core.disposeRuntimes();
      first.core.close();

      // A restart before any pause: a reading arrives before the squads are recovered.
      const second = squadCore(tmp, script(never), { dbPath });
      second.clock.t = first.clock.t + 60_000;
      second.core.ingest.execute([
        {
          key: "usage:claude:five_hour:restart",
          ts: second.clock.iso(),
          source: "sdk",
          provider: "claude",
          projectId: "",
          type: "usage.limits",
          data: {
            provider: "claude",
            window: "five_hour",
            usedPercent: 47,
            resetsAt: new Date(RESET_S * 1000).toISOString(),
          },
        },
      ]);
      second.squads.recover();
      expect(second.squad(squadId).paused).toBeDefined();
      expect(
        dataOf(second.events("budget.measured")).map((d) => (d as { last: number }).last),
      ).toEqual([40, 47]);

      const third = squadCore(tmp, script(never), { dbPath });
      expect(budgetState(third.squad(squadId), {})).toMatchObject({ spent: 17 });
    });
  });

  test("with nothing measured yet a plan squad never pauses (it is measuring)", async () => {
    await withTempDir(async (tmp) => {
      const h = squadCore(tmp, async (a) => {
        if (a.isBriefing) return;
        if (a.isPlanner) return a.result({ structured: testPlan(), cost: 0.1 });
        await a.prompt(1);
        return work(a);
      });
      const squadId = await approved(h, tmp);
      await h.squads.idle(squadId);
      expect(h.failures).toEqual([]);
      expect(h.squad(squadId).phase).toBe("deliver");
      expect(h.events("budget.baseline")).toEqual([]);
      expect(h.events("budget.warned")).toEqual([]);
      expect(h.squad(squadId).paused).toBeUndefined();
    });
  });

  test("a plan squad on an API-key account is refused at create", async () => {
    await withTempDir(async (tmp) => {
      const cwd = join(tmp, "app");
      await mkdir(cwd, { recursive: true });
      // Not known yet: the briefing's own running session answers the usage read.
      const h = squadCore(tmp, async (a) => {
        if (a.isBriefing) a.q.usageAnswer = API_KEY_USAGE;
      });
      const p = { cwd, brief: "Demo", budget: PLAN_BUDGET, autonomy: "guarded" as const };
      await expect(h.squads.create(p)).rejects.toBeInstanceOf(PlanUsageUnavailableError);
      expect(h.core.broadcaster.status().providers.claude?.account?.plan).toBe("api");
      const [failed] = h.core.projection.squads();
      expect(failed?.phase).toBe("failed");
      expect(h.agents[0]?.q.calls).toContain("usage:skipBehaviors");
      // Known now: refused before anything starts. A dollar squad still goes.
      const before = h.agents.length;
      await expect(h.squads.create(p)).rejects.toBeInstanceOf(PlanUsageUnavailableError);
      expect(h.agents).toHaveLength(before);
      await h.squads.create({ ...p, budget: { mode: "usd", amount: 10 } });
      const err = toRpcError(new PlanUsageUnavailableError("claude"), new SilentLogger(), "x");
      expect(err).toMatchObject({
        code: RpcErrors.planUsageUnavailable.code,
        data: { provider: "claude" },
      });
      expect(err.message).toContain("dollar budget");
    });
  });

  test("the monitor reads through the squad's running session, records the account and the baseline", async () => {
    await withTempDir(async (tmp) => {
      const h = squadCore(tmp, async (a) => {
        if (a.isBriefing) return;
        if (a.isPlanner) return a.result({ structured: testPlan(), cost: 0.1 });
        a.q.usageAnswer = usageAnswer({ five_hour: 12, seven_day: 40 }, "2026-10-12T15:00:00Z");
        await a.prompt(1);
        await never();
      });
      const squadId = await approved(h, tmp);
      await until(() => h.agents.filter((a) => a.isRole).length === 2, "role sessions");
      const usage = h.core.usage;
      if (!usage) throw new Error("no monitor");
      await usage.tick();
      expect(h.core.projection.usage()["claude:five_hour"]?.usedPercent).toBe(12);
      expect(h.core.projection.usage()["claude:seven_day"]?.usedPercent).toBe(40);
      expect(h.core.broadcaster.status().providers.claude?.account).toMatchObject({
        plan: "limited",
        planType: "max",
      });
      expect(h.events("budget.baseline").map((e) => e.data)).toMatchObject([
        { squadId, round: 1, baseline: 12 },
      ]);
      // Only the plan windows were asked for, never the transcript scan.
      const reads = h.agents.flatMap((a) => a.q.calls.filter((c) => c.startsWith("usage")));
      expect(reads.length).toBeGreaterThan(0);
      expect(new Set(reads)).toEqual(new Set(["usage:skipBehaviors"]));
      await h.squads.stop({ squadId });
      await h.squads.idle(squadId);
    });
  });
});

describe("the plan usage monitor", () => {
  function setup(answers: (PlanUsageReading | undefined)[]) {
    const clock = new FakeClock();
    const store = new MemoryEventStore();
    const projection = new ProjectionService();
    const ingest = new IngestEvents(store, projection, new RecordingPublisher());
    const status = new EventBroadcaster(clock, {
      providers: { claude: { found: true } },
      indexing: { done: 0, total: 0 },
      demo: false,
    });
    const reads: (readonly string[] | undefined)[] = [];
    const source: PlanUsageSource = {
      provider: "claude",
      read: async (prefer) => {
        reads.push(prefer);
        return answers.shift();
      },
    };
    const hooks = { usage: 0, unavailable: [] as string[] };
    const monitor = new PlanUsageMonitor({
      sources: [source],
      ingest,
      status,
      squads: projection,
      clock,
      logger: new SilentLogger(),
    });
    monitor.bind({
      onUsage: () => hooks.usage++,
      onPlanUnavailable: (p) => hooks.unavailable.push(p),
    });
    return { clock, store, projection, ingest, status, monitor, reads, hooks };
  }

  const reading = (used: number): PlanUsageReading => ({
    limited: true,
    planType: "pro",
    limits: [{ window: "seven_day", usedPercent: used }],
  });

  test("a read becomes ephemeral usage.limits and the account's plan; a minute must pass before the next", async () => {
    const t = setup([reading(34), reading(35), reading(36)]);
    await t.monitor.refresh();
    expect(t.projection.usage()["claude:seven_day"]?.usedPercent).toBe(34);
    expect(t.store.rows).toEqual([]);
    expect(t.status.providerStatus("claude")?.account).toEqual({
      plan: "limited",
      planType: "pro",
    });
    expect(t.hooks.usage).toBe(1);
    await t.monitor.refresh();
    expect(t.reads).toHaveLength(1);
    t.clock.advance(60_000);
    await t.monitor.refresh();
    expect(t.reads).toHaveLength(2);
    await t.monitor.refresh({ force: true });
    expect(t.reads).toHaveLength(3);
  });

  test("Gravita's Codex profile is read apart: its readings never stand for the user's account", async () => {
    const t = setup([]);
    const read = (account?: "squadProfile") => ({
      provider: "codex" as const,
      ...(account ? { account } : {}),
      read: async () => ({
        limited: true,
        planType: account ? "team" : "plus",
        limits: [
          {
            window: "five_hour" as const,
            usedPercent: account ? 12 : 64,
            ...(account ? { account } : {}),
          },
        ],
      }),
    });
    const monitor = new PlanUsageMonitor({
      sources: [read("squadProfile"), read()],
      ingest: t.ingest,
      status: t.status,
      squads: t.projection,
      clock: t.clock,
      logger: new SilentLogger(),
    });
    // Both are read, neither waits on the other's last read.
    expect(await monitor.refresh({ provider: "codex" })).toMatchObject({ planType: "team" });
    const usage = t.projection.usage();
    expect(usage["codex:squadProfile:five_hour"]?.usedPercent).toBe(12);
    expect(usage["codex:five_hour"]?.usedPercent).toBe(64);
    // The provider's account is the user's own.
    expect(t.status.providerStatus("codex")?.account).toEqual({
      plan: "limited",
      planType: "plus",
    });
    // A squad session's rate limits don't speak for the user's account either.
    t.ingest.execute([
      {
        key: "usage:codex:seven_day:rpc",
        ts: t.clock.iso(),
        source: "codex-rpc",
        provider: "codex",
        projectId: "p",
        type: "usage.limits",
        data: {
          provider: "codex",
          account: "squadProfile",
          window: "seven_day",
          usedPercent: 3,
          planType: "team",
        },
      },
    ]);
    expect(t.status.providerStatus("codex")?.account?.planType).toBe("plus");
  });

  test("an API-key account turns the provider's plan to api and tells the squads", async () => {
    const t = setup([{ limited: false, limits: [] }]);
    await t.monitor.refresh();
    expect(t.status.providerStatus("claude")?.account?.plan).toBe("api");
    expect(t.hooks.unavailable).toEqual(["claude"]);
  });

  test("a rate limit event from a session marks the account as limited and checks the budgets", () => {
    const t = setup([]);
    t.ingest.execute([
      {
        key: "usage:claude:five_hour:x",
        ts: t.clock.iso(),
        source: "sdk",
        provider: "claude",
        projectId: "p",
        type: "usage.limits",
        data: { provider: "claude", window: "five_hour", usedPercent: 12 },
      },
    ]);
    expect(t.status.providerStatus("claude")?.account?.plan).toBe("limited");
    expect(t.hooks.usage).toBe(1);
    expect(t.reads).toEqual([]);
  });

  test("it reads on its own only while a plan squad works: often until its baseline, then every few minutes", async () => {
    const t = setup([reading(1), reading(2), reading(3)]);
    t.monitor.start();
    t.clock.advance(PLAN_BASELINE_POLL_MS);
    await Promise.resolve();
    expect(t.reads).toEqual([]);
    const env = { source: "gravita", provider: "gravita", projectId: "p" } as const;
    t.ingest.execute([
      {
        ...env,
        key: "c",
        ts: t.clock.iso(),
        type: "squad.created",
        data: {
          squadId: "q1",
          cwd: "/w",
          brief: "x",
          models: { planner: "opus", roles: "opus" },
          budget: { mode: "plan", maxPercent: 20, window: "five_hour" },
          autonomy: "guarded",
        },
      },
      {
        ...env,
        key: "ph",
        ts: t.clock.iso(),
        type: "squad.phase_changed",
        data: { squadId: "q1", phase: "build" },
      },
    ]);
    // Not counted yet: read again soon.
    t.clock.advance(PLAN_USAGE_POLL_MS);
    await settled();
    expect(t.reads).toHaveLength(1);
    t.clock.advance(PLAN_BASELINE_POLL_MS);
    await settled();
    expect(t.reads).toHaveLength(2);
    // Counted: every few minutes.
    t.ingest.execute([
      {
        ...env,
        key: "b",
        ts: t.clock.iso(),
        type: "budget.baseline",
        data: {
          squadId: "q1",
          provider: "claude",
          window: "five_hour",
          round: 1,
          baseline: 1,
          carried: 0,
          current: 1,
        },
      },
    ]);
    t.clock.advance(PLAN_BASELINE_POLL_MS);
    await settled();
    expect(t.reads).toHaveLength(3);
    t.clock.advance(PLAN_BASELINE_POLL_MS);
    await settled();
    expect(t.reads).toHaveLength(3);
    t.clock.advance(PLAN_USAGE_POLL_MS);
    await settled();
    expect(t.reads).toHaveLength(4);
    t.monitor.stop();
  });
});

async function settled() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}
