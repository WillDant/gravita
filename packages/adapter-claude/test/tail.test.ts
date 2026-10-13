import { describe, expect, test } from "bun:test";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { EventOf, GravitaEvent } from "@gravita/protocol";
import fc from "fast-check";
import { readSession, readSessionHead, SessionTail } from "../src";

const FIXTURE_DIR = join(import.meta.dir, "../../../fixtures/claude/2.1.296/nested-background");
const SID = "11111111-1111-4111-8111-111111111111";
const MAIN = `${SID}.jsonl`;

interface FixtureFile {
  rel: string;
  bytes: Buffer;
  /** Meta files are written in one go, like Claude Code does. */
  whole: boolean;
}

async function loadFixture(): Promise<FixtureFile[]> {
  const files: FixtureFile[] = [
    { rel: MAIN, bytes: await readFile(join(FIXTURE_DIR, MAIN)), whole: false },
  ];
  const subDir = join(SID, "subagents");
  for (const name of (await readdir(join(FIXTURE_DIR, subDir))).sort()) {
    const rel = join(subDir, name);
    files.push({
      rel,
      bytes: await readFile(join(FIXTURE_DIR, rel)),
      whole: name.endsWith(".meta.json"),
    });
  }
  return files;
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "gravita-tail-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function append(dir: string, rel: string, bytes: Uint8Array) {
  await mkdir(dirname(join(dir, rel)), { recursive: true });
  await appendFile(join(dir, rel), bytes);
}

const keySet = (events: GravitaEvent[]) => new Set(events.map((e) => e.key));

const spawns = (events: GravitaEvent[]) =>
  events
    .filter((e): e is EventOf<"agent.spawned"> => e.type === "agent.spawned")
    .map((e) => ({ agentId: e.agentId, ts: e.ts, data: e.data }))
    .sort((a, b) => String(a.agentId).localeCompare(String(b.agentId)));

describe("SessionTail", () => {
  test("random byte chunks across all files yield the same events as readSession", async () => {
    const files = await loadFixture();
    const expected = await readSession(join(FIXTURE_DIR, MAIN), { projectId: "p1" });

    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 1, max: 400 }), { minLength: 1, maxLength: 40 }),
        fc.array(fc.nat(), { minLength: 1, maxLength: 40 }),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 40 }),
        (sizes, picks, polls) =>
          withTempDir(async (dir) => {
            // Frozen clock: spawns may only be emitted once meta and parent are known.
            const tail = new SessionTail(join(dir, MAIN), { projectId: "p1", now: () => 0 });
            const got: GravitaEvent[] = [];
            const cursor = files.map(() => 0);
            for (let step = 0; ; step++) {
              const open = files.flatMap((f, i) => (cursor[i]! < f.bytes.length ? [i] : []));
              if (!open.length) break;
              const i = open[picks[step % picks.length]! % open.length]!;
              const f = files[i]!;
              const size = f.whole ? f.bytes.length : sizes[step % sizes.length]!;
              const chunk = f.bytes.subarray(cursor[i]!, cursor[i]! + size);
              await append(dir, f.rel, chunk);
              cursor[i] = cursor[i]! + chunk.length;
              if (polls[step % polls.length]) got.push(...(await tail.poll()));
            }
            got.push(...(await tail.poll()));

            expect(keySet(got)).toEqual(keySet(expected));
            expect(spawns(got)).toEqual(spawns(expected));
            expect(got.filter((e) => e.type === "session.started")).toHaveLength(1);
          }),
      ),
      { numRuns: 40 },
    );
    // Forty runs of real file appends: generous, so a busy CI box doesn't time it out.
  }, 30_000);

  test("a poll with nothing new returns nothing", async () => {
    await withTempDir(async (dir) => {
      for (const f of await loadFixture()) await append(dir, f.rel, f.bytes);
      const tail = new SessionTail(join(dir, MAIN), { projectId: "p1" });
      expect((await tail.poll()).length).toBeGreaterThan(10);
      expect(await tail.poll()).toEqual([]);
    });
  });

  test("resumes from a checkpoint without re-reading consumed bytes", async () => {
    const files = await loadFixture();
    const expected = await readSession(join(FIXTURE_DIR, MAIN), { projectId: "p1" });
    await withTempDir(async (dir) => {
      const main = files[0]!;
      const half = main.bytes.indexOf(0x0a, main.bytes.length / 2) + 1;
      await append(dir, main.rel, main.bytes.subarray(0, half));
      const first = new SessionTail(join(dir, MAIN), { projectId: "p1" });
      const before = await first.poll();

      const resumed = new SessionTail(join(dir, MAIN), {
        projectId: "p1",
        checkpoint: first.checkpoint(),
      });
      await append(dir, main.rel, main.bytes.subarray(half));
      for (const f of files.slice(1)) await append(dir, f.rel, f.bytes);
      const after = await resumed.poll();

      expect(keySet([...before, ...after])).toEqual(keySet(expected));
      const overlap = [...keySet(after)].filter((k) => keySet(before).has(k));
      expect(overlap).toEqual([]);
    });
  });

  test("rescans a file that was replaced or truncated", async () => {
    const files = await loadFixture();
    await withTempDir(async (dir) => {
      for (const f of files) await append(dir, f.rel, f.bytes);
      const tail = new SessionTail(join(dir, MAIN), { projectId: "p1" });
      const all = keySet(await tail.poll());

      // Atomic replace (new inode) with the same content plus one more line.
      const extra = `${JSON.stringify({
        type: "user",
        uuid: "u-extra",
        timestamp: "2026-10-12T10:02:00.000Z",
        message: { role: "user", content: "one more thing" },
      })}\n`;
      const tmp = join(dir, "replace.tmp");
      await writeFile(tmp, Buffer.concat([files[0]!.bytes, Buffer.from(extra)]));
      await rename(tmp, join(dir, MAIN));
      const afterReplace = keySet(await tail.poll());
      expect(afterReplace.has("user:u-extra")).toBe(true);
      for (const k of afterReplace) expect(all.has(k) || k === "user:u-extra").toBe(true);

      // Truncation to the first line: re-read from 0, nothing new invented.
      const firstLine = files[0]!.bytes.subarray(0, files[0]!.bytes.indexOf(0x0a) + 1);
      await writeFile(join(dir, MAIN), firstLine);
      const afterTruncate = await tail.poll();
      expect(afterTruncate.map((e) => e.key)).toEqual(["user:u1"]);
    });
  });

  test("holds a partial line until it is complete", async () => {
    await withTempDir(async (dir) => {
      const line = JSON.stringify({
        type: "user",
        uuid: "u1",
        timestamp: "2026-10-12T10:00:00.000Z",
        cwd: "/work/demo",
        message: { role: "user", content: "hello" },
      });
      const tail = new SessionTail(join(dir, MAIN), { projectId: "p1" });
      await append(dir, MAIN, Buffer.from(line.slice(0, 20)));
      expect(await tail.poll()).toEqual([]);
      await append(dir, MAIN, Buffer.from(`${line.slice(20)}\n`));
      expect((await tail.poll()).map((e) => e.type)).toEqual(["session.started", "message.user"]);
    });
  });

  test("without a meta file, the spawn waits for the grace period then falls back to main", async () => {
    const files = await loadFixture();
    await withTempDir(async (dir) => {
      let now = 0;
      for (const f of files) if (!f.rel.endsWith(".meta.json")) await append(dir, f.rel, f.bytes);
      const tail = new SessionTail(join(dir, MAIN), {
        projectId: "p1",
        now: () => now,
        spawnGraceMs: 1000,
      });
      expect(spawns(await tail.poll())).toEqual([]);
      now = 1000;
      const late = spawns(await tail.poll());
      expect(late.map((s) => s.data.parentAgentId)).toEqual(["main", "main", "main"]);
    });
  });
});

describe("readSessionHead", () => {
  test("finds the cwd and first timestamp", async () => {
    expect(await readSessionHead(join(FIXTURE_DIR, MAIN))).toEqual({
      cwd: "/work/demo",
      ts: "2026-10-12T10:00:00.000Z",
    });
  });

  test("returns null for a missing or cwd-less file", async () => {
    await withTempDir(async (dir) => {
      expect(await readSessionHead(join(dir, "missing.jsonl"))).toBeNull();
      await writeFile(join(dir, "x.jsonl"), `${JSON.stringify({ type: "summary" })}\n`);
      expect(await readSessionHead(join(dir, "x.jsonl"))).toBeNull();
    });
  });
});
