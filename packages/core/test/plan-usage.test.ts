import { describe, expect, test } from "bun:test";
import type { GravitaEvent } from "@gravita/protocol";
import { keys } from "@gravita/protocol/ids";
import fc from "fast-check";
import {
  advanceMeter,
  applyAll,
  budgetState,
  codexPlanUsage,
  emptyState,
  type GravitaState,
  meterPoints,
  type PlanMeter,
  planShareUsed,
  squadBudget,
  startMeter,
} from "../src";

// A squad's budget as a share of the user's plan: the baseline captured when it starts
// building, the change since, a window that resets mid-squad, several providers, and the
// projection of plan usage readings.

const Q = "q1";
const t = (min: number) => new Date(Date.UTC(2026, 9, 13, 10, min)).toISOString();
const RESET = t(60);
const NEXT_RESET = new Date(Date.UTC(2026, 9, 13, 15, 0)).toISOString();
const env = { source: "gravita" as const, provider: "gravita" as const, projectId: "p" };

function sq(min: number, key: string, e: Pick<GravitaEvent, "type" | "data">): GravitaEvent {
  return { ...env, key, ts: t(min), ...e } as GravitaEvent;
}

function usage(
  min: number,
  usedPercent: number,
  o: {
    provider?: "claude" | "codex";
    window?: string;
    resetsAt?: string;
    model?: string;
    account?: "squadProfile";
  } = {},
): GravitaEvent {
  const provider = o.provider ?? "claude";
  const window = o.window ?? "five_hour";
  return {
    key: keys.usageLimits(provider, window, o.model, `${o.account ?? ""}${min}`),
    ts: t(min),
    source: "sdk",
    provider,
    projectId: "",
    type: "usage.limits",
    data: {
      provider,
      window,
      usedPercent,
      ...(o.model ? { model: o.model } : {}),
      ...(o.account ? { account: o.account } : {}),
      ...(o.resetsAt !== null ? { resetsAt: o.resetsAt ?? RESET } : {}),
    },
  } as GravitaEvent;
}

const created = (budget: unknown) =>
  sq(0, keys.squadCreated(Q), {
    type: "squad.created",
    data: {
      squadId: Q,
      cwd: "/w",
      brief: "Todo app",
      models: { planner: "opus", roles: "sonnet" },
      ...(budget as object),
      autonomy: "guarded",
    },
  } as Pick<GravitaEvent, "type" | "data">);

const phase = (min: number, p: string, round = 1) =>
  sq(min, keys.squadPhase(Q, p, round), {
    type: "squad.phase_changed",
    data: { squadId: Q, phase: p },
  } as Pick<GravitaEvent, "type" | "data">);

const baseline = (
  min: number,
  d: { round?: number; baseline: number; carried?: number; current?: number; provider?: string },
) =>
  sq(min, keys.budgetBaseline(Q, d.provider ?? "claude", "five_hour", d.round ?? 1), {
    type: "budget.baseline",
    data: {
      squadId: Q,
      provider: d.provider ?? "claude",
      window: "five_hour",
      round: d.round ?? 1,
      baseline: d.baseline,
      carried: d.carried ?? 0,
      current: d.current ?? d.baseline,
      resetsAt: RESET,
    },
  } as Pick<GravitaEvent, "type" | "data">);

const PLAN = { budget: { mode: "plan", maxPercent: 20, window: "five_hour" } };

const squadOf = (s: GravitaState) => {
  const q = s.squads[Q];
  if (!q) throw new Error("no squad");
  return q;
};

describe("the meter of one window", () => {
  const m0 = startMeter("claude", "five_hour", { usedPercent: 30, resetsAt: RESET });
  const at = (min: number, usedPercent: number, resetsAt = RESET) => ({
    usedPercent,
    resetsAt,
    ts: t(min),
  });

  test.each([
    ["nothing moved", [], 0],
    ["the window moved by 6 points", [at(5, 36)], 6],
    ["a lower reading within the window keeps the highest", [at(5, 36), at(6, 34)], 6],
    ["below the baseline by less than half a point is noise", [at(5, 29.8)], 0],
    // The window reset under the squad: 10 points before it, then 4 in the new window.
    ["a drop below the baseline is a new window", [at(5, 40), at(70, 4, NEXT_RESET)], 14],
    // Read after the reset time: a new window even if the number went up.
    ["a reading after the reset time is a new window", [at(5, 40), at(61, 45, NEXT_RESET)], 55],
    [
      "two resets carry both windows",
      [
        at(5, 40),
        at(70, 4, NEXT_RESET),
        at(80, 9, NEXT_RESET),
        at(301, 2, "2026-10-13T20:00:00.000Z"),
      ],
      21,
    ],
  ])("%s", (_name, samples, points) => {
    let m: PlanMeter = m0;
    for (const s of samples) m = advanceMeter(m, s);
    expect(meterPoints(m)).toBe(points);
  });

  describe("telling a new window from a late reading of the old one", () => {
    const sec = (min: number, s: number) =>
      new Date(Date.UTC(2026, 9, 13, 10, min, s)).toISOString();
    const raised = advanceMeter(m0, at(50, 60));

    test("a reading of the old window just after its reset is ignored, every time", () => {
      // Read a second after the reset, still naming the reset that just passed.
      const late = { usedPercent: 60, resetsAt: RESET, ts: sec(60, 1) };
      expect(advanceMeter(raised, late)).toEqual(raised);
      expect(advanceMeter(advanceMeter(raised, late), { ...late, ts: sec(62, 0) })).toEqual(raised);
      // The new window's first reading then counts once: 30 points carried, 3 new.
      const m = advanceMeter(advanceMeter(raised, late), at(65, 3, NEXT_RESET));
      expect(m).toMatchObject({ round: 2, carried: 30, last: 3, resetsAt: NEXT_RESET });
      expect(meterPoints(advanceMeter(m, { ...late, ts: sec(66, 0) }))).toBe(33);
    });

    test("a reading whose reset time already passed when it was read changes nothing", () => {
      expect(advanceMeter(raised, at(70, 90, RESET))).toEqual(raised);
      expect(advanceMeter(raised, at(59, 95, t(58)))).toEqual(raised);
    });

    test("the next window read a little before the old reset time (clock skew) is new", () => {
      // Low, but above the baseline: only its later reset time tells.
      const m = advanceMeter(raised, at(59, 35, NEXT_RESET));
      expect(m).toMatchObject({ round: 2, carried: 30, baseline: 0, last: 35 });
      expect(meterPoints(m)).toBe(65);
    });

    test("a low first reading after the reset, above the baseline, with a later reset time", () => {
      const m = advanceMeter(raised, at(61, 32, NEXT_RESET));
      expect(m).toMatchObject({ round: 2, carried: 30, last: 32, resetsAt: NEXT_RESET });
    });

    test("a reset time that moved by a few seconds is the same window", () => {
      const jitter = new Date(Date.parse(RESET) + 90_000).toISOString();
      const m = advanceMeter(raised, at(55, 62, jitter));
      expect(m).toMatchObject({ round: 1, last: 62, resetsAt: jitter });
    });

    test("without reset times, a drop below the highest reading after the reset is new", () => {
      const noReset = { usedPercent: 10, ts: t(61) };
      expect(advanceMeter(raised, noReset)).toMatchObject({ round: 2, carried: 30, last: 10 });
      // Before the reset time the same drop is noise (the highest reading stays).
      expect(advanceMeter(raised, { ...noReset, usedPercent: 40, ts: t(55) })).toMatchObject({
        round: 1,
        last: 60,
      });
    });
  });

  test("a reset moves to the next round and starts counting from 0", () => {
    const m = advanceMeter(advanceMeter(m0, at(5, 40)), at(70, 4, NEXT_RESET));
    expect(m).toMatchObject({ round: 2, baseline: 0, carried: 10, last: 4, resetsAt: NEXT_RESET });
  });

  test("the share never decreases, whatever the readings (resets included)", () => {
    const reading = fc.record({
      gap: fc.integer({ min: 1, max: 120 }),
      used: fc.double({ min: 0, max: 100, noNaN: true }),
    });
    fc.assert(
      fc.property(fc.array(reading, { maxLength: 40 }), (readings) => {
        let m = m0;
        let min = 0;
        let before = meterPoints(m);
        for (const r of readings) {
          min += r.gap;
          // The window resets every five hours from 11:00.
          const resetsAt = new Date(
            Date.UTC(2026, 9, 13, 11 + 5 * Math.floor(min / 300)),
          ).toISOString();
          m = advanceMeter(m, { usedPercent: r.used, resetsAt, ts: t(min) });
          const now = meterPoints(m);
          if (now < before) return false;
          before = now;
        }
        return true;
      }),
    );
  });

  test("within one window the share is the highest reading minus the baseline", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 30, max: 100, noNaN: true }), { maxLength: 30 }),
        (xs) => {
          let m = m0;
          xs.forEach((used, i) => {
            m = advanceMeter(m, at(i + 1, used));
          });
          const expected = Math.round((Math.max(30, ...xs) - 30) * 100) / 100;
          return meterPoints(m) === expected && m.round === 1;
        },
      ),
    );
  });
});

describe("a plan squad's share", () => {
  const building = [created(PLAN), phase(1, "foundation"), baseline(2, { baseline: 30 })];

  test("is measuring until the baseline is recorded, then counts the change since", () => {
    const s = applyAll(emptyState(), [created(PLAN), phase(1, "foundation"), usage(1, 30)]);
    expect(budgetState(squadOf(s), s.usage)).toMatchObject({
      unit: "points",
      limit: 20,
      spent: 0,
      measuring: true,
    });
    applyAll(s, [baseline(2, { baseline: 30 }), usage(3, 36)]);
    expect(planShareUsed(squadOf(s), s.usage)).toEqual({
      points: 6,
      byProvider: { claude: 6 },
      provider: "claude",
    });
    expect(budgetState(squadOf(s), s.usage)).toMatchObject({
      spent: 6,
      limit: 20,
      ratio: 0.3,
      measuring: false,
      window: "five_hour",
    });
  });

  test("with several providers the most consumed one counts", () => {
    const s = applyAll(emptyState(), [
      ...building,
      baseline(2, { baseline: 10, provider: "codex" }),
      usage(3, 33),
      usage(3, 19, { provider: "codex", account: "squadProfile" }),
    ]);
    expect(planShareUsed(squadOf(s), s.usage)).toEqual({
      points: 9,
      byProvider: { claude: 3, codex: 9 },
      provider: "codex",
    });
  });

  test("a Codex meter counts Gravita's Codex profile: the user's own Codex never moves it", () => {
    const s = applyAll(emptyState(), [
      ...building,
      baseline(2, { baseline: 10, provider: "codex" }),
      // The user's own Codex (their CLI, their rollouts) on another account.
      usage(3, 70, { provider: "codex" }),
      usage(4, 2, { provider: "codex", resetsAt: NEXT_RESET }),
      usage(5, 14, { provider: "codex", account: "squadProfile" }),
    ]);
    expect(planShareUsed(squadOf(s), s.usage).byProvider.codex).toBe(4);
    expect(squadOf(s).budget.meters?.["codex:five_hour"]).toMatchObject({ round: 1, last: 14 });
    // Both readings are kept, apart: Home shows the user's, the squad counts its profile's.
    expect(s.usage["codex:five_hour"]?.usedPercent).toBe(2);
    expect(s.usage["codex:squadProfile:five_hour"]).toMatchObject({
      account: "squadProfile",
      usedPercent: 14,
    });
    // A later user reading changes nothing for the squad either.
    applyAll(s, [usage(6, 95, { provider: "codex" })]);
    expect(planShareUsed(squadOf(s), s.usage).byProvider.codex).toBe(4);
  });

  test("a window reset mid-squad carries what was used and counts the new window from 0", () => {
    const s = applyAll(emptyState(), [
      ...building,
      usage(10, 42),
      usage(70, 5, { resetsAt: NEXT_RESET }),
    ]);
    expect(planShareUsed(squadOf(s), s.usage).points).toBe(17);
    // The live meter moved to round 2; the guard records it so a restart counts from it.
    expect(squadOf(s).budget.meters?.["claude:five_hour"]).toMatchObject({
      round: 2,
      savedRound: 1,
      carried: 12,
    });
    applyAll(s, [baseline(71, { round: 2, baseline: 0, carried: 12, current: 5 })]);
    expect(squadOf(s).budget.meters?.["claude:five_hour"]).toMatchObject({
      round: 2,
      savedRound: 2,
    });
    // Replayed from the stored facts alone (a restart): the same count.
    const replay = applyAll(emptyState(), [
      ...building,
      baseline(71, { round: 2, baseline: 0, carried: 12, current: 5 }),
    ]);
    expect(planShareUsed(squadOf(replay), replay.usage).points).toBe(17);
  });

  test("replayed from stored facts alone (no usage readings), the points used are restored", () => {
    const measured = (min: number, last: number, round = 1) =>
      sq(min, keys.budgetMeasured(Q, "claude", "five_hour", round, last), {
        type: "budget.measured",
        data: { squadId: Q, provider: "claude", window: "five_hour", round, last },
      } as Pick<GravitaEvent, "type" | "data">);
    // Live: readings moved the meter to 41; the guard noted 38 and then 41.
    const live = applyAll(emptyState(), [...building, usage(5, 38), measured(5, 38), usage(9, 41)]);
    applyAll(live, [measured(9, 41)]);
    expect(planShareUsed(squadOf(live), live.usage).points).toBe(11);
    // A restart replays the stored events only: usage.limits are never stored.
    const replay = applyAll(emptyState(), [...building, measured(5, 38), measured(9, 41)]);
    expect(planShareUsed(squadOf(replay), replay.usage).points).toBe(11);
    expect(squadOf(replay).budget.meters?.["claude:five_hour"]).toMatchObject({
      round: 1,
      last: 41,
      savedLast: 41,
    });
    // Out of order, or a measure of another round, changes nothing more.
    const odd = applyAll(emptyState(), [
      ...building,
      measured(9, 41),
      measured(5, 38),
      measured(10, 4, 2),
    ]);
    expect(planShareUsed(squadOf(odd), odd.usage).points).toBe(11);
  });

  test("readings while the squad is paused or finished don't count", () => {
    const paused = sq(5, keys.squadPaused(Q, 1), {
      type: "squad.paused",
      data: { squadId: Q, reason: "Paused by you." },
    });
    const s = applyAll(emptyState(), [...building, usage(3, 34), paused, usage(6, 50)]);
    expect(planShareUsed(squadOf(s), s.usage).points).toBe(4);
    applyAll(s, [phase(7, "done")]);
    expect(planShareUsed(squadOf(s), s.usage).points).toBe(4);
  });

  test("a raised share re-arms the squad's levels", () => {
    const s = applyAll(emptyState(), [
      ...building,
      sq(4, keys.budget(Q, "squad", Q, "warned"), {
        type: "budget.warned",
        data: { squadId: Q, scope: "squad", scopeId: Q, unit: "points", used: 15, limit: 20 },
      }),
      sq(5, keys.budgetChanged(Q, 1), {
        type: "squad.budget_changed",
        data: { squadId: Q, maxPercent: 30, previousPercent: 20 },
      }),
    ]);
    expect(squadOf(s).budgetPlan).toEqual({ maxPercent: 30, window: "five_hour" });
    expect(squadOf(s).budget.warned).toEqual([]);
    expect(squadBudget(squadOf(s))).toEqual({ mode: "plan", maxPercent: 30, window: "five_hour" });
  });

  test("squads made with budgetUsd (and USD squads) are dollars, as before", () => {
    for (const budget of [{ budgetUsd: 20 }, { budget: { mode: "usd", amount: 20 } }]) {
      const s = applyAll(emptyState(), [created(budget), usage(1, 50)]);
      const q = squadOf(s);
      expect(q.budgetUsd).toBe(20);
      expect(q.budgetPlan).toBeUndefined();
      expect(squadBudget(q)).toEqual({ mode: "usd", amount: 20 });
      expect(budgetState(q, s.usage)).toEqual({
        spent: 0,
        limit: 20,
        unit: "usd",
        ratio: 0,
        measuring: false,
      });
    }
  });
});

describe("the projection of plan usage", () => {
  test("keeps the latest reading per provider, window and model, account-wide", () => {
    const s = applyAll(emptyState(), [
      usage(5, 40),
      usage(3, 35),
      usage(4, 60, { window: "seven_day" }),
      usage(4, 12, { window: "seven_day_model", model: "opus" }),
      usage(6, 8, { provider: "codex" }),
    ]);
    expect(s.usage["claude:five_hour"]).toMatchObject({ usedPercent: 40, ts: t(5) });
    expect(s.usage["claude:seven_day"]?.usedPercent).toBe(60);
    expect(s.usage["claude:seven_day_model:opus"]).toMatchObject({
      model: "opus",
      usedPercent: 12,
    });
    expect(s.usage["codex:five_hour"]?.usedPercent).toBe(8);
    // It belongs to no session or project.
    expect(s.sessions).toEqual({});
    expect(s.projects).toEqual({});
  });

  test("a snapshot from before plan usage gets the map on the first event", () => {
    const old = { projects: {}, sessions: {}, squads: {}, seq: 0 } as unknown as GravitaState;
    applyAll(old, [usage(1, 10)]);
    expect(old.usage["claude:five_hour"]?.usedPercent).toBe(10);
  });
});

describe("Codex's rate limits as plan usage", () => {
  const now = Date.parse("2026-10-13T10:00:00.000Z");

  test("a rollout's token_count.rate_limits (snake_case, epoch seconds)", () => {
    const payload = {
      rate_limits: {
        primary: { used_percent: 42.5, window_minutes: 300, resets_at: 1_760_356_800 },
        secondary: { used_percent: 12, window_minutes: 10_080, resets_in_seconds: 3_600 },
        plan_type: "plus",
      },
    };
    expect(codexPlanUsage(payload, now)).toEqual([
      {
        window: "five_hour",
        usedPercent: 42.5,
        resetsAt: new Date(1_760_356_800 * 1000).toISOString(),
        planType: "plus",
      },
      {
        window: "seven_day",
        usedPercent: 12,
        resetsAt: "2026-10-13T11:00:00.000Z",
        planType: "plus",
      },
    ]);
  });

  test("the app-server's account/rateLimits (camelCase), a full window and an odd one", () => {
    const payload = {
      rateLimits: {
        primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1_760_356_800 },
        secondary: { usedPercent: 3, windowDurationMins: 1_440 },
        planType: "pro",
      },
    };
    expect(codexPlanUsage(payload, now)).toEqual([
      {
        window: "five_hour",
        usedPercent: 100,
        resetsAt: new Date(1_760_356_800 * 1000).toISOString(),
        planType: "pro",
        status: "rejected",
      },
      { window: "other", usedPercent: 3, planType: "pro" },
    ]);
  });

  test("windows without a length are primary = 5-hour and secondary = weekly; junk maps to nothing", () => {
    expect(
      codexPlanUsage({ primary: { used_percent: 5 }, secondary: { used_percent: 7 } }, now),
    ).toEqual([
      { window: "five_hour", usedPercent: 5 },
      { window: "seven_day", usedPercent: 7 },
    ]);
    expect(codexPlanUsage({ primary: { window_minutes: 300 } }, now)).toEqual([]);
    expect(codexPlanUsage(null, now)).toEqual([]);
    expect(codexPlanUsage("nope", now)).toEqual([]);
  });
});
