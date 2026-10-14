import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { squadModels, squadSubagents } from "../../src/domain/squad-policy";
import { ClaudeDetector } from "../../src/infrastructure/claude/claude-cli-locator";
import {
  BRIEFING_TOOLS,
  claudeAccess,
  PLANNER_TOOLS,
} from "../../src/infrastructure/claude/sdk/claude-access";
import {
  claudeSubagentEnv,
  ROLE_ENV,
  squadEnv,
} from "../../src/infrastructure/claude/sdk/claude-subagent-env";
import { pathFromCommandV } from "../../src/infrastructure/providers/cli-locator";
import { parseArgs } from "../../src/main/args";
import { createCore } from "../../src/main/container";

describe("Claude Code's side of the provider seam", () => {
  test("a planning session's access becomes Claude Code's tool lists and answers", () => {
    const planner = claudeAccess("read-only");
    expect(planner.tools).toEqual(["Read", "Grep", "Glob"]);
    expect(planner.disallowedTools).toEqual(["Write", "Edit", "NotebookEdit", "Bash", "MultiEdit"]);
    expect(
      ["Read", "Grep", "Glob", "LS", "Bash", "AskUserQuestion"].map(planner.permission),
    ).toEqual(["allow", "allow", "allow", "deny", "deny", "deny"]);
    const briefing = claudeAccess("read-and-ask");
    expect(briefing.tools).toEqual([...BRIEFING_TOOLS]);
    expect(BRIEFING_TOOLS).toEqual([...PLANNER_TOOLS, "AskUserQuestion"]);
    expect(["Read", "AskUserQuestion", "Write"].map(briefing.permission)).toEqual([
      "allow",
      "ask",
      "deny",
    ]);
  });

  test("a subagent policy becomes Claude Code's environment", () => {
    expect(ROLE_ENV).toEqual({
      CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: "4",
      CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: "2",
    });
    expect(claudeSubagentEnv(squadSubagents(squadModels(), { role: true }))).toEqual({
      ...ROLE_ENV,
      CLAUDE_CODE_SUBAGENT_MODEL: "haiku",
    });
    expect(squadEnv(squadModels())).toEqual({ CLAUDE_CODE_SUBAGENT_MODEL: "haiku" });
    expect(claudeSubagentEnv(undefined)).toEqual({});
    // A provider without a tier table keeps its own subagent model.
    expect(squadSubagents(squadModels(), { provider: "codex" })).toEqual({});
  });

  test("the CLI locator finds any binary, aliases included", () => {
    expect(pathFromCommandV("banner\n/opt/homebrew/bin/codex\n", "codex")).toBe(
      "/opt/homebrew/bin/codex",
    );
    expect(pathFromCommandV("alias codex='/Users/x/bin/codex'", "codex")).toBe(
      "/Users/x/bin/codex",
    );
    expect(pathFromCommandV("alias claude='/Users/x/claude'", "codex")).toBeUndefined();
  });

  test("Claude Code's detector is a provider detector", async () => {
    const detector = new ClaudeDetector(async () => ({ found: true, path: "/bin/claude" }));
    expect(detector.provider).toBe("claude");
    expect(await detector.detect()).toEqual({ found: true, path: "/bin/claude" });
  });
});

describe("--codex-home", () => {
  test("defaults to ~/.codex and expands ~", () => {
    expect(parseArgs([]).codexHome).toBe(join(homedir(), ".codex"));
    expect(parseArgs(["--codex-home", "~/elsewhere"]).codexHome).toBe(join(homedir(), "elsewhere"));
  });

  test("reaches the core, which nothing reads yet", () => {
    const core = createCore({ dbPath: ":memory:", demo: true, codexHome: "/tmp/codex" });
    expect(core.homes.codex).toBe("/tmp/codex");
    expect(core.providers).toBeUndefined();
    core.close();
  });
});
