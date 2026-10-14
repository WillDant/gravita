import { describe, expect, test } from "bun:test";
import { GravitaEvent } from "@gravita/protocol";
import { claudePlanUsage, SdkSessionMapper, toPercent } from "../src";

// Claude's plan usage: the stream's rate_limit_event and the answer of the usage read, in
// Gravita's provider-neutral `usage.limits` terms.

const NOW = "2026-10-13T10:00:00.000Z";
const RESETS = 1_760_356_800; // epoch seconds

const mapper = () => new SdkSessionMapper({ projectId: "p1", sessionId: "s1", now: () => NOW });

const rateLimit = (info: Record<string, unknown>, uuid = "u1") => ({
  type: "rate_limit_event",
  uuid,
  session_id: "s1",
  rate_limit_info: info,
});

describe("rate_limit_event", () => {
  test("a fraction (0–1) and a percent (0–100) both become a percent", () => {
    const [fraction] = mapper().map(
      rateLimit({
        status: "allowed",
        rateLimitType: "five_hour",
        utilization: 0.42,
        resetsAt: RESETS,
      }),
    );
    const [percent] = mapper().map(
      rateLimit({
        status: "allowed",
        rateLimitType: "five_hour",
        utilization: 42,
        resetsAt: RESETS,
      }),
    );
    for (const e of [fraction, percent]) {
      expect(GravitaEvent.parse(e)).toMatchObject({
        type: "usage.limits",
        source: "sdk",
        provider: "claude",
        projectId: "p1",
        data: {
          provider: "claude",
          window: "five_hour",
          usedPercent: 42,
          resetsAt: new Date(RESETS * 1000).toISOString(),
          status: "allowed",
        },
      });
      // Account-wide: no session, so it never creates or touches one.
      expect(e?.sessionId).toBeUndefined();
    }
  });

  test("once a session showed percents, a later small value stays a percent", () => {
    const m = mapper();
    m.map(rateLimit({ rateLimitType: "seven_day", utilization: 12 }, "a"));
    const [later] = m.map(rateLimit({ rateLimitType: "seven_day", utilization: 0.5 }, "b"));
    expect(later?.data).toMatchObject({ window: "seven_day", usedPercent: 0.5 });
  });

  test("percents are learnt per window: an overage past 100% leaves a five-hour fraction alone", () => {
    const m = mapper();
    const [overage] = m.map(
      rateLimit({ status: "allowed", rateLimitType: "overage", utilization: 1.05 }, "a"),
    );
    const [fiveHour] = m.map(
      rateLimit({ status: "allowed", rateLimitType: "five_hour", utilization: 0.45 }, "b"),
    );
    expect(overage?.data).toMatchObject({ window: "other", model: "overage" });
    expect(fiveHour?.data).toMatchObject({ window: "five_hour", usedPercent: 45 });
  });

  test("weekly model windows, warnings, and a rejection without a number", () => {
    const events = [
      rateLimit(
        { status: "allowed_warning", rateLimitType: "seven_day_opus", utilization: 0.81 },
        "a",
      ),
      rateLimit({ status: "rejected", rateLimitType: "seven_day" }, "b"),
      rateLimit({ status: "allowed", rateLimitType: "overage", utilization: 0.1 }, "c"),
    ].flatMap((msg) => mapper().map(msg));
    expect(events.map((e) => e.data)).toEqual([
      {
        provider: "claude",
        window: "seven_day_model",
        model: "opus",
        usedPercent: 81,
        status: "warning",
      },
      { provider: "claude", window: "seven_day", usedPercent: 100, status: "rejected" },
      { provider: "claude", window: "other", model: "overage", usedPercent: 10, status: "allowed" },
    ]);
    // Distinct windows, distinct keys.
    expect(new Set(events.map((e) => e.key)).size).toBe(3);
  });

  test("an event without a number (and not a rejection) or without info maps to nothing", () => {
    expect(mapper().map(rateLimit({ status: "allowed", rateLimitType: "five_hour" }))).toEqual([]);
    expect(mapper().map({ type: "rate_limit_event", uuid: "x" })).toEqual([]);
  });

  test("toPercent clamps to 0–100", () => {
    expect(toPercent(1.5)).toBe(1.5);
    expect(toPercent(1)).toBe(100);
    expect(toPercent(250)).toBe(100);
    expect(toPercent(-3)).toBe(0);
  });
});

describe("the usage read", () => {
  test("a subscription: each window with a number, model windows by name", () => {
    const answer = {
      session: { total_cost_usd: 0.4 },
      subscription_type: "max",
      rate_limits_available: true,
      rate_limits: {
        five_hour: { utilization: 34, resets_at: "2026-10-13T14:00:00Z" },
        seven_day: { utilization: 61.5, resets_at: "2026-10-16T09:00:00Z" },
        seven_day_opus: { utilization: null, resets_at: null },
        seven_day_sonnet: null,
        model_scoped: [{ display_name: "Fable", utilization: 7, resets_at: null }],
        extra_usage: {
          is_enabled: false,
          monthly_limit: null,
          used_credits: null,
          utilization: null,
        },
      },
      behaviors: null,
    };
    expect(claudePlanUsage(answer)).toEqual({
      limited: true,
      planType: "max",
      limits: [
        {
          window: "five_hour",
          usedPercent: 34,
          resetsAt: "2026-10-13T14:00:00.000Z",
          planType: "max",
        },
        {
          window: "seven_day",
          usedPercent: 61.5,
          resetsAt: "2026-10-16T09:00:00.000Z",
          planType: "max",
        },
        { window: "seven_day_model", model: "fable", usedPercent: 7, planType: "max" },
      ],
    });
  });

  test("an API key: no plan limits", () => {
    expect(
      claudePlanUsage({ subscription_type: null, rate_limits_available: false, rate_limits: null }),
    ).toEqual({ limited: false, limits: [] });
  });

  test("an answer of another shape is no reading (the API is experimental)", () => {
    expect(claudePlanUsage(undefined)).toBeUndefined();
    expect(claudePlanUsage({ rate_limits: {} })).toBeUndefined();
  });
});
