import { agentColor, lineCode, NAMED } from "@gravita/orbs";
import { describe, expect, it } from "vitest";
import { setLocale } from "@/shared/i18n/i18n";
import { agentName, agentTypeLabel, displayId } from "./agent";

setLocale("en");

const CODEX_ROLES = ["explorer", "worker", "default"] as const;

describe("Codex subagent roles", () => {
  it("each own a named line hue, stable and apart from the main agent's", () => {
    for (const role of CODEX_ROLES) {
      expect(NAMED[role]).toBeDefined();
      expect(agentColor(role)).toBe(NAMED[role]);
      expect(agentColor(role).line).not.toBe(agentColor("main").line);
    }
    expect(new Set(CODEX_ROLES.map((r) => agentColor(r).line)).size).toBe(CODEX_ROLES.length);
    // An explorer reads like Claude Code's Explore, the default role like general-purpose.
    expect(agentColor("explorer")).toEqual(agentColor("Explore"));
    expect(agentColor("default")).toEqual(agentColor("general-purpose"));
    expect(CODEX_ROLES.map(lineCode)).toEqual(["E", "W", "D"]);
  });

  it("read as names in the user's language", () => {
    expect(CODEX_ROLES.map(agentTypeLabel)).toEqual(["Explorer", "Worker", "Default agent"]);
    expect(agentName({ id: "codex:019cf4f0", agentType: "explorer" })).toBe("Explorer");
    setLocale("pt-BR");
    expect(agentTypeLabel("explorer")).toBe("Explorador");
    setLocale("en");
    // Claude Code's types show as the user's tools name them.
    expect(agentTypeLabel("Explore")).toBe("Explore");
    expect(agentName({ id: "main", agentType: "main" })).toBe("Main agent");
  });

  it("show ids without the provider prefix kept for routing", () => {
    expect(displayId("codex:019cf4f0-977f-7e41")).toBe("019cf4f0-977f-7e41");
    expect(displayId("cursor:0af03c5f-4a38")).toBe("0af03c5f-4a38");
    expect(displayId("a1b2c3")).toBe("a1b2c3");
  });
});
