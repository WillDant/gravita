import { describe, expect, test } from "bun:test";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { HookIngest } from "../../src/application/services/hook-ingest";
import { ProjectionService } from "../../src/application/services/projection-service";
import { InMemorySessionRuntimeRegistry } from "../../src/application/services/session-runtime-registry";
import { AnnounceProject } from "../../src/application/usecases/announce-project";
import { DrainHookSpool } from "../../src/application/usecases/drain-hook-spool";
import { IngestEvents } from "../../src/application/usecases/ingest-events";
import { ClaudeHookTranslator } from "../../src/infrastructure/claude/claude-hook-translator";
import { FsHookSpool, SPOOL_FILE } from "../../src/infrastructure/system/fs-hook-spool";
import { FsRuntimeFile } from "../../src/infrastructure/system/fs-runtime-file";
import { FakeClock, MemoryEventStore, RecordingPublisher, SilentLogger } from "../fakes";
import { withTempDir } from "../helpers";

const SID = "33333333-3333-4333-8333-333333333333";
const line = (o: Record<string, unknown>) =>
  JSON.stringify({ session_id: SID, cwd: "/work/demo", ...o });

function pipeline() {
  const clock = new FakeClock();
  const store = new MemoryEventStore();
  const ingest = new IngestEvents(store, new ProjectionService(), new RecordingPublisher());
  const hooks = new HookIngest({
    translator: new ClaudeHookTranslator(),
    ingest,
    projects: new AnnounceProject(
      { resolve: async (cwd) => ({ id: "p1", root: cwd, name: "demo" }) },
      ingest,
      clock,
    ),
    ownership: new InMemorySessionRuntimeRegistry(ingest, clock),
    sessions: new ProjectionService(),
    clock,
    logger: new SilentLogger(),
  });
  return { store, hooks };
}

describe("hook spool drain", () => {
  test("ingests each spooled line once, in order, skips bad lines and removes the files", async () => {
    await withTempDir(async (dir) => {
      const spoolDir = join(dir, "spool");
      await mkdir(spoolDir, { mode: 0o700 });
      // A pass cut short earlier left this one; it goes first.
      await writeFile(
        join(spoolDir, "hooks-1000.processing"),
        `${line({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "/a" }, tool_use_id: "toolu_0" })}\n`,
        { mode: 0o600 },
      );
      await writeFile(
        join(spoolDir, SPOOL_FILE),
        [
          line({
            hook_event_name: "PreToolUse",
            tool_name: "Bash",
            tool_input: { command: "ls" },
            tool_use_id: "toolu_1",
          }),
          "{not json",
          "",
          line({
            hook_event_name: "PostToolUse",
            tool_name: "Bash",
            tool_input: { command: "ls" },
            tool_use_id: "toolu_1",
            tool_response: { stdout: "a" },
          }),
          // Same fact again: stored once.
          line({
            hook_event_name: "PreToolUse",
            tool_name: "Bash",
            tool_input: { command: "ls" },
            tool_use_id: "toolu_1",
          }),
        ].join("\n"),
        { mode: 0o600 },
      );

      const { store, hooks } = pipeline();
      const drain = new DrainHookSpool(new FsHookSpool(spoolDir), hooks, new SilentLogger());
      expect(await drain.execute()).toBe(4);
      expect(store.rows.map((e) => e.key)).toEqual([
        "project:p1:discovered",
        "tool:toolu_0:started",
        "tool:toolu_1:started",
        "tool:toolu_1:completed",
      ]);
      expect(store.rows.every((e) => e.source !== "hook" || e.sessionId === SID)).toBe(true);
      expect(await readdir(spoolDir)).toEqual([]);
      expect(await drain.execute()).toBe(0);
      expect(store.rows).toHaveLength(4);
    });
  });

  test("a missing spool is nothing to do; the directory is created owner-only", async () => {
    await withTempDir(async (dir) => {
      const spoolDir = join(dir, "spool");
      const { hooks } = pipeline();
      expect(
        await new DrainHookSpool(new FsHookSpool(spoolDir), hooks, new SilentLogger()).execute(),
      ).toBe(0);
      expect((await stat(spoolDir)).mode & 0o777).toBe(0o700);
    });
  });
});

describe("runtime file", () => {
  test("is written atomically, owner-only, and removed only by the engine that wrote it", async () => {
    await withTempDir(async (dir) => {
      const dataDir = join(dir, "data");
      const file = new FsRuntimeFile(dataDir);
      const info = { port: 4321, hookToken: "f".repeat(64), pid: 111, version: "0.0.0" };
      file.write(info);
      expect(JSON.parse(await Bun.file(file.path).text())).toEqual(info);
      expect((await stat(file.path)).mode & 0o777).toBe(0o600);
      expect((await stat(dataDir)).mode & 0o777).toBe(0o700);
      expect(await readdir(dataDir)).toEqual(["runtime.json"]);

      file.removeIfOwned(222);
      expect(await Bun.file(file.path).exists()).toBe(true);
      file.write({ ...info, pid: 222, port: 5555 });
      file.removeIfOwned(111);
      expect(JSON.parse(await Bun.file(file.path).text()).port).toBe(5555);
      file.removeIfOwned(222);
      expect(await Bun.file(file.path).exists()).toBe(false);
      file.removeIfOwned(222);
    });
  });
});

describe("hook spool drain during shutdown", () => {
  test("a drain cut short by the engine closing keeps the spool for the next start", async () => {
    await withTempDir(async (dir) => {
      const spoolDir = join(dir, "spool");
      await mkdir(spoolDir, { mode: 0o700 });
      const pre = (id: string) =>
        line({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: {}, tool_use_id: id });
      await writeFile(join(spoolDir, SPOOL_FILE), [pre("toolu_1"), pre("toolu_2")].join("\n"));
      const { store, hooks } = pipeline();
      const spool = new FsHookSpool(spoolDir);
      const drain = new DrainHookSpool(
        {
          drain: (each) =>
            spool.drain(async (p) => {
              await each(p);
              hooks.close();
            }),
        },
        hooks,
        new SilentLogger(),
      );
      expect(await drain.execute()).toBe(0);
      expect(store.rows.map((e) => e.key)).toEqual([
        "project:p1:discovered",
        "tool:toolu_1:started",
      ]);
      expect((await readdir(spoolDir)).filter((n) => n.endsWith(".processing"))).toHaveLength(1);

      const next = pipeline();
      expect(await new DrainHookSpool(spool, next.hooks, new SilentLogger()).execute()).toBe(2);
      expect(await readdir(spoolDir)).toEqual([]);
    });
  });
});
