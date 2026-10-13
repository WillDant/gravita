import { describe, expect, test } from "bun:test";
import { appendFile, cp, mkdir, readdir, stat, utimes } from "node:fs/promises";
import { join } from "node:path";
import { ClaudeIngest } from "../src/claude/ingest";
import { Hub } from "../src/hub";
import { ProjectResolver } from "../src/projects";
import { Store } from "../src/store";
import { withTempDir } from "./helpers";

const FIXTURE = join(import.meta.dir, "../../../fixtures/claude/2.1.296/nested-background");
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

function ingestFor(home: string, hub: Hub) {
  return new ClaudeIngest({
    claudeHome: home,
    lookbackDays: 14,
    hub,
    projects: new ProjectResolver(hub, async () => null),
    isLive: () => false,
  });
}

describe("claude ingest", () => {
  test("indexes a session tree, resumes after restart and never writes to claudeHome", async () => {
    await withTempDir(async (root) => {
      const home = join(root, "claude");
      const projectDir = join(home, "projects", "-anything-not-a-path");
      await mkdir(projectDir, { recursive: true });
      await cp(FIXTURE, projectDir, { recursive: true });
      // An old session outside the lookback window is ignored.
      const old = join(projectDir, "33333333-3333-4333-8333-333333333333.jsonl");
      await cp(join(projectDir, `${SID}.jsonl`), old);
      const longAgo = new Date(Date.now() - 30 * 86_400_000);
      await utimes(old, longAgo, longAgo);
      const before = await treeState(home);

      const db = join(root, "gravita.db");
      const hub = new Hub(new Store(db), { demo: false });
      await ingestFor(home, hub).discover();

      expect(Object.keys(hub.state.sessions)).toEqual([SID]);
      const s = hub.state.sessions[SID]!;
      expect(s.cwd).toBe("/work/demo");
      expect(hub.state.projects[s.projectId]!.name).toBe("demo");
      expect(s.agents.a0000000000000003!.parentId).toBe("a0000000000000002");
      expect(Object.keys(s.agents).sort()).toEqual([
        "a0000000000000001",
        "a0000000000000002",
        "a0000000000000003",
        "main",
      ]);
      expect(hub.getStatus().indexing).toEqual({ done: 1, total: 1 });
      const seq = hub.store.maxSeq();
      expect(seq).toBeGreaterThan(10);
      expect(hub.store.loadTail(SID)?.projectId).toBe(s.projectId);
      hub.close();
      hub.store.close();

      // Restart on the same database: resumes from the checkpoint, stores nothing twice.
      const again = new Hub(new Store(db), { demo: false });
      const ingest = ingestFor(home, again);
      await ingest.discover();
      expect(again.store.maxSeq()).toBe(seq);
      expect(again.state.sessions[SID]!.agents.main!.toolCount).toBe(s.agents.main!.toolCount);
      expect(await treeState(home)).toEqual(before);

      // A new line in a hot session is picked up by the fast poll.
      const line = {
        type: "user",
        uuid: "u-live",
        timestamp: new Date().toISOString(),
        message: { role: "user", content: "and tests" },
      };
      await appendFile(join(projectDir, `${SID}.jsonl`), `${JSON.stringify(line)}\n`);
      await ingest.discover();
      await ingest.pollHot();
      expect(again.store.sessionEvents(SID).some((e) => e.key === "user:u-live")).toBe(true);
      again.close();
      again.store.close();
    });
  });
});
