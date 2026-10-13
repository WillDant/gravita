import { describe, expect, test } from "bun:test";
import { appendFile, readFile, rename, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { EventOf, GravitaEvent } from "@gravita/protocol";
import fc from "fast-check";
import {
  CodexSessionTail,
  groupThreads,
  readCodexSession,
  readRolloutHead,
  type ThreadFile,
} from "../src";
import { type Scenario, scenarioFiles, scenarioSession, withTempDir } from "./helpers";

interface Copy {
  name: string;
  bytes: Buffer;
  meta: ThreadFile["meta"];
}

async function load(scenario: Scenario): Promise<Copy[]> {
  const files = await scenarioFiles(scenario);
  return Promise.all(
    files.map(async (f) => ({
      name: basename(f.path),
      bytes: await readFile(f.path),
      meta: f.meta,
    })),
  );
}

const keySet = (events: readonly GravitaEvent[]) => new Set(events.map((e) => e.key));

const spawns = (events: readonly GravitaEvent[]) =>
  events
    .filter((e): e is EventOf<"agent.spawned"> => e.type === "agent.spawned")
    .map((e) => ({ agentId: e.agentId, ts: e.ts, data: e.data }))
    .sort((a, b) => String(a.agentId).localeCompare(String(b.agentId)));

/** The fixture's session as it will be under `dir`. */
function sessionIn(dir: string, copies: Copy[]) {
  const [session] = groupThreads(copies.map((c) => ({ path: join(dir, c.name), meta: c.meta })));
  return session!;
}

describe("CodexSessionTail", () => {
  for (const scenario of ["nested-background", "subagents", "exec-and-patch"] as const) {
    test(`${scenario}: random byte chunks across the rollouts yield the same events as one read`, async () => {
      const copies = await load(scenario);
      const expected = await readCodexSession(await scenarioSession(scenario), { projectId: "p1" });

      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.integer({ min: 1, max: 600 }), { minLength: 1, maxLength: 40 }),
          fc.array(fc.nat(), { minLength: 1, maxLength: 40 }),
          fc.array(fc.boolean(), { minLength: 1, maxLength: 40 }),
          (sizes, picks, polls) =>
            withTempDir(async (dir) => {
              const session = sessionIn(dir, copies);
              // Frozen clock: a spawn waits until its parent's spawn_agent output is read.
              const tail = new CodexSessionTail(session.root, { projectId: "p1", now: () => 0 });
              tail.addThreads(session.subagents);
              const got: GravitaEvent[] = [];
              const cursor = copies.map(() => 0);
              for (let step = 0; ; step++) {
                const open = copies.flatMap((c, i) => (cursor[i]! < c.bytes.length ? [i] : []));
                if (!open.length) break;
                const i = open[picks[step % picks.length]! % open.length]!;
                const c = copies[i]!;
                const chunk = c.bytes.subarray(
                  cursor[i]!,
                  cursor[i]! + sizes[step % sizes.length]!,
                );
                await appendFile(join(dir, c.name), chunk);
                cursor[i] = cursor[i]! + chunk.length;
                if (polls[step % polls.length]) got.push(...(await tail.poll()));
              }
              got.push(...(await tail.poll()));

              expect(keySet(got)).toEqual(keySet(expected));
              expect(spawns(got)).toEqual(spawns(expected));
              expect(got.filter((e) => e.type === "session.started")).toHaveLength(1);
            }),
        ),
        { numRuns: 25 },
      );
    }, 60_000);
  }

  test("a poll with nothing new returns nothing", async () => {
    await withTempDir(async (dir) => {
      const copies = await load("nested-background");
      for (const c of copies) await writeFile(join(dir, c.name), c.bytes);
      const session = sessionIn(dir, copies);
      const tail = new CodexSessionTail(session.root, { projectId: "p1" });
      tail.addThreads(session.subagents);
      expect((await tail.poll()).length).toBeGreaterThan(20);
      expect(await tail.poll()).toEqual([]);
    });
  });

  test("resumes from a checkpoint without re-reading consumed bytes", async () => {
    const copies = await load("nested-background");
    const expected = await readCodexSession(await scenarioSession("nested-background"), {
      projectId: "p1",
    });
    await withTempDir(async (dir) => {
      const session = sessionIn(dir, copies);
      // Every rollout half written, cut mid-line.
      for (const c of copies)
        await writeFile(join(dir, c.name), c.bytes.subarray(0, c.bytes.length / 2));
      const first = new CodexSessionTail(session.root, { projectId: "p1", spawnGraceMs: 0 });
      first.addThreads(session.subagents);
      const before = await first.poll();
      const checkpoint = JSON.parse(JSON.stringify(first.checkpoint()));

      for (const c of copies)
        await appendFile(join(dir, c.name), c.bytes.subarray(c.bytes.length / 2));
      const resumed = new CodexSessionTail(session.root, { projectId: "p1", checkpoint });
      resumed.addThreads(session.subagents);
      const after = await resumed.poll();

      expect(keySet([...before, ...after])).toEqual(keySet(expected));
      expect([...keySet(after)].filter((k) => keySet(before).has(k))).toEqual([]);
      expect(after.filter((e) => e.type === "session.started")).toEqual([]);
    });
  });

  test("holds a partial line until it is complete, and tracks the open turn", async () => {
    await withTempDir(async (dir) => {
      const [c] = await load("simple-edit");
      const lines = c!.bytes.toString("utf8").split("\n");
      const path = join(dir, c!.name);
      const tail = new CodexSessionTail({ path, meta: c!.meta }, { projectId: "p1" });
      // session_meta and the start of the next record.
      await writeFile(path, `${lines[0]}\n${lines[1]!.slice(0, 15)}`);
      expect(await tail.poll()).toEqual([]);
      expect(tail.openTurn()).toBe(false);
      const taskStarted = lines.findIndex((l) => l.includes('"task_started"'));
      await appendFile(
        path,
        `${lines
          .slice(1, taskStarted + 1)
          .join("\n")
          .slice(15)}\n`,
      );
      expect(await tail.poll()).toEqual([]);
      expect(tail.openTurn()).toBe(true);
      await appendFile(path, `${lines.slice(taskStarted + 1).join("\n")}`);
      const rest = await tail.poll();
      expect(rest[0]?.type).toBe("session.started");
      expect(rest.at(-1)?.type).toBe("turn.completed");
      expect(tail.openTurn()).toBe(false);
    });
  });

  test("rereads a rollout that was replaced or truncated", async () => {
    await withTempDir(async (dir) => {
      const [c] = await load("simple-edit");
      const path = join(dir, c!.name);
      await writeFile(path, c!.bytes);
      const tail = new CodexSessionTail({ path, meta: c!.meta }, { projectId: "p1" });
      const all = keySet(await tail.poll());

      const extra = `${JSON.stringify({
        timestamp: "2026-10-12T09:01:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          id: "msg_extra",
          role: "assistant",
          content: [{ type: "output_text", text: "One more thing." }],
        },
      })}\n`;
      await writeFile(join(dir, "tmp"), Buffer.concat([c!.bytes, Buffer.from(extra)]));
      await rename(join(dir, "tmp"), path);
      const replaced = keySet(await tail.poll());
      const added = [...replaced].filter((k) => !all.has(k));
      expect(added).toHaveLength(1);
      expect(added[0]).toContain("msg_extra");

      await writeFile(path, c!.bytes.subarray(0, c!.bytes.indexOf(0x0a) + 1));
      expect(await tail.poll()).toEqual([]);
    });
  });

  test("without its parent's spawn output, a subagent spawns under its parent after the grace", async () => {
    await withTempDir(async (dir) => {
      const copies = await load("subagents");
      // The root rollout stops before the spawn outputs.
      for (const c of copies) {
        const bytes =
          c.meta.role === "root"
            ? Buffer.from(
                c.bytes
                  .toString("utf8")
                  .split("\n")
                  .filter((l) => !l.includes('"function_call_output"'))
                  .join("\n"),
              )
            : c.bytes;
        await writeFile(join(dir, c.name), bytes);
      }
      const session = sessionIn(dir, copies);
      let now = 0;
      const tail = new CodexSessionTail(session.root, {
        projectId: "p1",
        now: () => now,
        spawnGraceMs: 1000,
      });
      tail.addThreads(session.subagents);
      expect(spawns(await tail.poll())).toEqual([]);
      now = 1000;
      const late = spawns(await tail.poll());
      expect(late.map((s) => [s.data.parentAgentId, s.data.spawnToolUseId])).toEqual([
        ["main", undefined],
        ["main", undefined],
      ]);
    });
  });

  test("reads a zstd-compressed rollout whole", async () => {
    await withTempDir(async (dir) => {
      const [c] = await load("simple-edit");
      const path = join(dir, `${c!.name}.zst`);
      await writeFile(path, Bun.zstdCompressSync(c!.bytes));
      const meta = await readRolloutHead(path);
      expect(meta?.threadId).toBe(c!.meta.threadId);
      const expected = await readCodexSession(await scenarioSession("simple-edit"), {
        projectId: "p1",
      });
      const skipped: string[] = [];
      const tail = new CodexSessionTail(
        { path, meta: meta! },
        { projectId: "p1", onSkip: (p) => skipped.push(p) },
      );
      expect(keySet(await tail.poll())).toEqual(keySet(expected));
      expect(await tail.poll()).toEqual([]);

      // A frame still being written can't be decompressed: skipped, then read when whole.
      await writeFile(path, Buffer.from("not zstd"));
      expect(await tail.poll()).toEqual([]);
      expect(skipped).toEqual([path]);
    });
  });
});

describe("readRolloutHead", () => {
  test("reads the session meta of the first line, null for anything else", async () => {
    await withTempDir(async (dir) => {
      const [c] = await load("subagents");
      expect(c!.meta).toMatchObject({
        role: "root",
        cwd: "/work/demo",
        originator: "codex_vscode",
        cliVersion: "0.160.0",
      });
      expect(await readRolloutHead(join(dir, "missing.jsonl"))).toBeNull();
      await writeFile(
        join(dir, "x.jsonl"),
        `${JSON.stringify({ type: "turn_context", payload: {} })}\n`,
      );
      expect(await readRolloutHead(join(dir, "x.jsonl"))).toBeNull();
      // A first line still being written.
      const line = c!.bytes.subarray(0, c!.bytes.indexOf(0x0a));
      await writeFile(join(dir, "y.jsonl"), line.subarray(0, line.length - 5));
      expect(await readRolloutHead(join(dir, "y.jsonl"))).toBeNull();
      await writeFile(join(dir, "y.jsonl"), line);
      expect((await readRolloutHead(join(dir, "y.jsonl")))?.threadId).toBe(c!.meta.threadId);
    });
  });
});
