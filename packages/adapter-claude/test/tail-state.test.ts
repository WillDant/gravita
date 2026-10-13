import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RawRecord } from "../src";
import { nodeTranscriptFs, readSession, SessionTailState, type TranscriptFs } from "../src";

const FIXTURE_DIR = join(import.meta.dir, "../../../fixtures/claude/2.1.296/nested-background");
const SID = "11111111-1111-4111-8111-111111111111";
const MAIN = join(FIXTURE_DIR, `${SID}.jsonl`);

const line = (o: object) => Buffer.from(`${JSON.stringify(o)}\n`);
const user = (uuid: string, extra: object = {}) =>
  line({
    type: "user",
    uuid,
    timestamp: "2026-10-12T10:00:00.000Z",
    message: { role: "user", content: "hi" },
    ...extra,
  });

describe("SessionTailState (no file system)", () => {
  test("keeps a partial line pending, then emits it once complete", () => {
    const s = new SessionTailState("/x/s.jsonl", { projectId: "p1" });
    const bytes = user("u1", { cwd: "/work" });
    const st = (size: number) => ({ ino: 7, size, mtimeMs: 1 });

    let recs: RawRecord[] = [];
    expect(s.beginRead("main", st(10))).toBe(0);
    s.feed("main", bytes.subarray(0, 10), recs);
    s.endRead("main", recs);
    expect(recs).toEqual([]);

    recs = [];
    expect(s.beginRead("main", st(bytes.length))).toBe(10);
    s.feed("main", bytes.subarray(10), recs);
    s.endRead("main", recs);
    const events = s.assemble(new Map([["main", recs]]));
    expect(events.map((e) => e.type)).toEqual(["session.started", "message.user"]);
    expect(s.checkpoint().files.main).toMatchObject({ offset: bytes.length, ino: 7 });
  });

  test("a new inode or a shorter file restarts from 0; session.started is emitted once", () => {
    const s = new SessionTailState("/x/s.jsonl", { projectId: "p1" });
    const a = user("u1", { cwd: "/work" });
    const read = (ino: number, bytes: Buffer) => {
      const recs: RawRecord[] = [];
      const from = s.beginRead("main", { ino, size: bytes.length, mtimeMs: 1 });
      s.feed("main", bytes.subarray(from), recs);
      s.endRead("main", recs);
      return s.assemble(new Map([["main", recs]]));
    };
    expect(read(1, a).map((e) => e.key)).toEqual(["session:s:started", "user:u1"]);
    expect(read(2, a).map((e) => e.key)).toEqual(["user:u1"]);
  });

  test("spawn waits for the grace period without a meta file", () => {
    let now = 0;
    const s = new SessionTailState("/x/s.jsonl", {
      projectId: "p1",
      now: () => now,
      spawnGraceMs: 500,
    });
    s.addSubagents(["agent-a0000000000000001.jsonl", "notes.txt"]);
    const recs: RawRecord[] = [];
    s.beginRead("a0000000000000001", { ino: 1, size: 1, mtimeMs: 0 });
    s.feed("a0000000000000001", user("u2"), recs);
    s.endRead("a0000000000000001", recs);
    expect(s.assemble(new Map([["a0000000000000001", recs]])).map((e) => e.type)).toEqual([
      "message.user",
    ]);
    now = 500;
    expect(s.assemble(new Map()).map((e) => e.type)).toEqual(["agent.spawned"]);
    expect(s.metaWatch().map((w) => w.agentId)).toEqual(["a0000000000000001"]);
  });
});

describe("TranscriptFs", () => {
  test("readSession reads only the session's own files through the injected fs", async () => {
    const touched: string[] = [];
    const spy: TranscriptFs = {
      stat: (p) => {
        touched.push(p);
        return nodeTranscriptFs.stat(p);
      },
      readdir: (p) => {
        touched.push(p);
        return nodeTranscriptFs.readdir(p);
      },
      readRange: (p, pos, len) => {
        touched.push(p);
        return nodeTranscriptFs.readRange(p, pos, len);
      },
      readText: (p) => {
        touched.push(p);
        return nodeTranscriptFs.readText(p);
      },
    };
    const viaSpy = await readSession(MAIN, { projectId: "p1", fs: spy });
    expect(viaSpy).toEqual(await readSession(MAIN, { projectId: "p1" }));
    const sessionDir = join(dirname(MAIN), SID);
    expect(touched.every((p) => p === MAIN || p.startsWith(`${sessionDir}/`))).toBe(true);
    // Every subagent transcript and meta file was consulted, nothing else in the folder.
    const subDir = join(sessionDir, "subagents");
    const listed = (await readdir(subDir)).map((n) => join(subDir, n));
    for (const p of touched.filter((t) => t.startsWith(`${subDir}/`))) expect(listed).toContain(p);
  });
});
