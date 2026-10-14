import { describe, expect, test } from "bun:test";
import { CLAUDE_MODES, CODEX_MODES } from "@gravita/protocol/constants";
import {
  AUTO_MODELS,
  AUTO_MODELS_BY_PROVIDER,
  AUTO_SUBAGENT_MODEL,
  CLAUDE_MODE_OF,
  CODEX_MODE_OF,
  classifyModel,
  DEFAULT_MODE,
  estimatePlanCost,
  isModeOf,
  MODEL_PRICES,
  modeFor,
  modelFamily,
  modelTier,
  PRICES,
  PROVIDER_MODELS,
  stepUp,
  TIER_LADDER,
  tierModel,
  tokenCost,
} from "../src";
import { samplePlan } from "./squad-fixture";

describe("model tiers per provider", () => {
  test("Claude's tiers are Haiku, Sonnet and Opus, cheapest first", () => {
    expect(TIER_LADDER.map((t) => tierModel("claude", t))).toEqual(["haiku", "sonnet", "opus"]);
    expect(PROVIDER_MODELS.claude).toEqual({ low: "haiku", mid: "sonnet", high: "opus" });
  });

  test.each([
    ["claude-opus-5-5", "high"],
    ["HAIKU", "low"],
    ["sonnet", "mid"],
    ["default", "mid"],
    ["mystery-model", "mid"],
  ] as const)("%s is Claude's %s tier", (model, tier) => {
    expect(modelTier(model, "claude")).toBe(tier);
    expect(classifyModel(model)).toEqual({ provider: "claude", tier });
    expect(modelFamily(model)).toBe(tierModel("claude", tier) as never);
  });

  test("stepping up climbs the provider's ladder and stops at the top", () => {
    expect(stepUp("haiku", 1)).toBe("sonnet");
    expect(stepUp("claude-sonnet-5-5", 1)).toBe("opus");
    expect(stepUp("sonnet", 5, "claude")).toBe("opus");
    expect(stepUp("claude-opus-5-5", 1)).toBe("claude-opus-5-5");
    expect(stepUp("claude-sonnet-5-5", 0)).toBe("claude-sonnet-5-5");
  });

  test("the Automatic policy and its subagent model come from the tiers", () => {
    expect(AUTO_MODELS_BY_PROVIDER.claude).toBe(AUTO_MODELS);
    expect(AUTO_MODELS).toEqual({
      mode: "auto",
      briefing: "sonnet",
      planner: "opus",
      roles: "sonnet",
    });
    expect(AUTO_SUBAGENT_MODEL).toBe("haiku");
  });

  test("prices are keyed by provider and tier; Claude's family table is the same numbers", () => {
    expect(PRICES.opus).toBe(MODEL_PRICES.claude.high);
    expect(PRICES.sonnet).toBe(MODEL_PRICES.claude.mid);
    expect(PRICES.haiku).toBe(MODEL_PRICES.claude.low);
    const use = { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 };
    expect(tokenCost("opus", use)).toBe(tokenCost("opus", use, "claude"));
    expect(tokenCost("claude-opus-5-5", use)).toBe(MODEL_PRICES.claude.high.input);
  });

  test("an estimate for Claude is the same whether the provider is named or not", () => {
    const plan = samplePlan();
    expect(estimatePlanCost(plan, AUTO_MODELS, {}, "claude")).toEqual(
      estimatePlanCost(plan, AUTO_MODELS),
    );
  });
});

describe("session modes across providers", () => {
  test("the mapping table", () => {
    expect(CODEX_MODE_OF).toEqual({
      default: "ask",
      acceptEdits: "workspace",
      plan: "ask",
      bypassPermissions: "fullAccess",
    });
    expect(CLAUDE_MODE_OF).toEqual({
      ask: "default",
      workspace: "acceptEdits",
      fullAccess: "bypassPermissions",
    });
  });

  test("every mode of one provider maps to one of the other's, and back where it can", () => {
    for (const m of CLAUDE_MODES) expect(CODEX_MODES).toContain(CODEX_MODE_OF[m]);
    for (const m of CODEX_MODES) {
      expect(CLAUDE_MODES).toContain(CLAUDE_MODE_OF[m]);
      expect(CODEX_MODE_OF[CLAUDE_MODE_OF[m]]).toBe(m);
    }
  });

  test("modes belong to their provider; modeFor translates only when needed", () => {
    expect(isModeOf("claude", "acceptEdits")).toBe(true);
    expect(isModeOf("claude", "workspace")).toBe(false);
    expect(isModeOf("codex", "fullAccess")).toBe(true);
    expect(isModeOf("codex", "plan")).toBe(false);
    expect(isModeOf("claude", "toString")).toBe(false);
    expect(modeFor("codex", "plan")).toBe("ask");
    expect(modeFor("codex", "workspace")).toBe("workspace");
    expect(modeFor("claude", "fullAccess")).toBe("bypassPermissions");
    expect(modeFor("claude", "plan")).toBe("plan");
    expect(DEFAULT_MODE).toEqual({ claude: "default", codex: "ask" });
  });
});
