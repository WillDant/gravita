import { describe, expect, test } from "bun:test";
import { appendFile, cp, mkdir, readdir, stat, utimes } from "node:fs/promises";
import { join } from "node:path";
import type { SessionOwnership } from "../../src/application/ports/session-runtime";
import { AnnounceProject } from "../../src/application/usecases/announce-project";
import { ClaudeSessionSource } from "../../src/infrastructure/claude/claude-session-source";
import { TranscriptDiscovery } from "../../src/infrastructure/claude/transcript-discovery";
import { TailScheduler } from "../../src/infrastructure/sessions/tail-scheduler";
import { GitProjectDirectory } from "../../src/infrastructure/system/git-project-directory";
import { createCore, type EngineCore } from "../../src/main/container";
import { withTempDir } from "../helpers";

const FIXTURE = join(import.meta.dir, "../../../../fixtures/claude/2.1.296/nested-background");
const SID = "11111111-1111-4111-8111-111111111111";

/** Every file under `dir` with its size and mtime, to prove nothing was written. */
async function treeState(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const name of await readdir(dir, { recursive: true })) {
    const st = await stat(join(dir, name));
    out.push(`${name}:${st.isDirectory() ? "dir" : st.size}:${st.mtimeMs}`);
  }
  return out.sort();
}

function tailsFor(home: string, core: EngineCore, ownership: SessionOwnership = core.runtimes) {
  return new TailScheduler({
    sources: [
      new ClaudeSessionSource({
        discovery: new TranscriptDiscovery({
          claudeHome: home,
          lookbackDays: 14,
          clock: core.clock,
          isLive: () => false,
        }),
        clock: core.clock,
        isLive: () => false,
      }),
    ],
    ingest: core.ingest,
    checkpoints: core.checkpoints,
    projects: new AnnounceProject(
      new GitProjectDirectory(async () => null),
      core.ingest,
      core.clock,
    ),
    status: core.broadcaster,
    clock: core.clock,
    logger: core.logger,
    ownership,
  });
}

async function claudeHomeWithFixture(root: string): Promise<{ home: string; projectDir: string }> {
  const home = join(root, "claude");
  const projectDir = join(home, "projects", "-anything-not-a-path");
  await mkdir(projectDir, { recursive: true });
  await cp(FIXTURE, projectDir, { recursive: true });
  return { home, projectDir };
}

describe("claude transcripts", () => {
  test("indexes a session tree, resumes after restart and never writes to claudeHome", async () => {
    await withTempDir(async (root) => {
      const { home, projectDir } = await claudeHomeWithFixture(root);
      // An old session outside the lookback window is ignored.
      const old = join(projectDir, "33333333-3333-4333-8333-333333333333.jsonl");
      await cp(join(projectDir, `${SID}.jsonl`), old);
      const longAgo = new Date(Date.now() - 30 * 86_400_000);
      await utimes(old, longAgo, longAgo);
      const before = await treeState(home);

      const db = join(root, "gravita.db");
      const core = createCore({ dbPath: db, demo: false });
      await tailsFor(home, core).discover();

      const state = core.projection.snapshot().state;
      expect(Object.keys(state.sessions)).toEqual([SID]);
      const s = state.sessions[SID]!;
      expect(s.cwd).toBe("/work/demo");
      expect(state.projects[s.projectId]!.name).toBe("demo");
      expect(s.agents.a0000000000000003!.parentId).toBe("a0000000000000002");
      expect(Object.keys(s.agents).sort()).toEqual([
        "a0000000000000001",
        "a0000000000000002",
        "a0000000000000003",
        "main",
      ]);
      expect(core.broadcaster.status().indexing).toEqual({ done: 1, total: 1 });
      const seq = core.events.maxSeq();
      expect(seq).toBeGreaterThan(10);
      expect(core.checkpoints.load(SID)?.projectId).toBe(s.projectId);
      core.close();

      // Restart on the same database: resumes from the checkpoint, stores nothing twice.
      const again = createCore({ dbPath: db, demo: false });
      const tails = tailsFor(home, again);
      await tails.discover();
      expect(again.events.maxSeq()).toBe(seq);
      expect(again.projection.session(SID)!.agents.main!.toolCount).toBe(s.agents.main!.toolCount);
      expect(await treeState(home)).toEqual(before);

      // A new line in a hot session is picked up by the fast poll.
      const line = {
        type: "user",
        uuid: "u-live",
        timestamp: new Date().toISOString(),
        message: { role: "user", content: "and tests" },
      };
      await appendFile(join(projectDir, `${SID}.jsonl`), `${JSON.stringify(line)}\n`);
      await tails.discover();
      await tails.pollHot();
      expect(again.events.sessionEvents(SID).some((e) => e.key === "user:u-live")).toBe(true);
      again.close();
    });
  });

  test("skips a session a Gravita runtime owns, and reads it once the runtime ends", async () => {
    await withTempDir(async (root) => {
      const { home } = await claudeHomeWithFixture(root);
      const core = createCore({ dbPath: ":memory:", demo: false });
      let owned = true;
      const tails = tailsFor(home, core, { isOwned: (id) => owned && id === SID });

      await tails.discover();
      expect(core.events.maxSeq()).toBe(0);
      expect(core.broadcaster.status().indexing).toEqual({ done: 1, total: 1 });

      owned = false;
      await tails.pollHot();
      expect(core.projection.session(SID)?.cwd).toBe("/work/demo");
      expect(core.events.maxSeq()).toBeGreaterThan(10);
      core.close();
    });
  });
});
