import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { readSession } from "@gravita/adapter-claude";
import {
  codexAgentId,
  groupThreads,
  readCodexSession,
  readRolloutHead,
  type ThreadFile,
} from "@gravita/adapter-codex";
import { expectNestedBackgroundStory } from "./session-story";

// The same assertions over a Claude Code transcript and a Codex rollout set that tell the
// same story (fixtures/*/nested-background): one event model, whichever agent wrote it.

const FIXTURES = join(import.meta.dir, "../../../../fixtures");

describe("session story contract: nested background", () => {
  test("Claude Code transcripts", async () => {
    const events = await readSession(
      join(FIXTURES, "claude/2.1.296/nested-background/11111111-1111-4111-8111-111111111111.jsonl"),
      { projectId: "p1" },
    );
    const s = expectNestedBackgroundStory(events, {
      main: "main",
      explorer: "a0000000000000001",
      planner: "a0000000000000002",
      nested: "a0000000000000003",
    });
    expect(s.provider).toBe("claude");
  });

  test("Codex rollouts", async () => {
    const dir = join(FIXTURES, "codex/0.160/nested-background/sessions/2026/10/12");
    const files: ThreadFile[] = [];
    for (const name of (await readdir(dir)).sort()) {
      const meta = await readRolloutHead(join(dir, name));
      if (meta) files.push({ path: join(dir, name), meta });
    }
    const [session] = groupThreads(files);
    const events = await readCodexSession(session!, { projectId: "p1" });
    const id = (n: number) => `019a2b3c-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
    const s = expectNestedBackgroundStory(events, {
      main: "main",
      explorer: codexAgentId(id(0x102)),
      planner: codexAgentId(id(0x103)),
      nested: codexAgentId(id(0x104)),
    });
    expect(s.provider).toBe("codex");
  });
});
