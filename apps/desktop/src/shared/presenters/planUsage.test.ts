import { applyAll, emptyState, type SquadState } from "@gravita/core";
import { describe, expect, it } from "vitest";
import { setLocale } from "@/shared/i18n/i18n";
import { SQ, squadFixture } from "@/test/squadFixtures";
import { accountPlan, budgetFigure, planWindows, windowLine } from "./planUsage";

setLocale("en");

const NOW = Date.parse("2026-10-13T10:00:00.000Z");

describe("plan usage in words", () => {
  it("a window's use and reset: time alone today, weekday further out", () => {
    const u = {
      provider: "claude" as const,
      window: "seven_day" as const,
      usedPercent: 34,
      ts: "",
    };
    expect(windowLine({ ...u, resetsAt: "2026-10-16T09:00:00.000Z" }, NOW)).toMatch(
      /^Weekly: 34% used · resets [A-Z][a-z]{2} /,
    );
    expect(
      windowLine({ ...u, window: "five_hour", resetsAt: "2026-10-13T14:00:00.000Z" }, NOW),
    ).toMatch(/^5-hour: 34% used · resets \d/);
    // A reset already past says nothing about when.
    expect(windowLine({ ...u, usedPercent: 6.25, resetsAt: "2026-10-12T00:00:00.000Z" }, NOW)).toBe(
      "Weekly: 6.3% used",
    );
  });

  it("a squad's budget in its unit: dollars, points, or measuring", () => {
    const q = squadFixture("run").state.squads?.[SQ] as SquadState;
    expect(budgetFigure(q, {}).label).toMatch(/^\$[\d.]+ spent of \$/);
    const plan: SquadState = {
      ...q,
      budgetUsd: 0,
      budgetPlan: { maxPercent: 20, window: "five_hour" },
    };
    expect(budgetFigure(plan, {})).toMatchObject({ measuring: true, total: "20 pts", share: 0 });
    plan.budget = {
      ...q.budget,
      meters: {
        "claude:five_hour": {
          provider: "claude",
          window: "five_hour",
          baseline: 10,
          carried: 2,
          last: 18,
          round: 2,
          savedRound: 2,
        },
      },
    };
    expect(budgetFigure(plan, {})).toMatchObject({ spent: "10", share: 0.5, measuring: false });
  });

  it("the account's plan and the windows known", () => {
    const claude = { found: true, account: { plan: "api" as const } };
    const status = { providers: { claude }, claude, indexing: { done: 0, total: 0 }, demo: false };
    expect(accountPlan(status, "claude")).toBe("api");
    expect(accountPlan(status, "codex")).toBeUndefined();
    const state = applyAll(emptyState(), []);
    expect(planWindows(state.usage, "claude")).toEqual([]);
  });
});
