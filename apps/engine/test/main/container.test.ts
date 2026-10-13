import { describe, expect, test } from "bun:test";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { RuntimeFile } from "@gravita/protocol/constants";
import { createCore, ENGINE_VERSION, startEngine } from "../../src/main/container";
import { FakeRuntime } from "../fakes";
import { withTempDir } from "../helpers";

class SlowRuntime extends FakeRuntime {
  constructor(
    id: string,
    private readonly ms: number,
  ) {
    super(id);
  }

  override async dispose() {
    await new Promise((r) => setTimeout(r, this.ms));
    this.disposed = true;
  }
}

describe("shutdown", () => {
  test("disposeRuntimes waits for the runtimes, up to a cap", async () => {
    const core = createCore({ dbPath: ":memory:", demo: true });
    const quick = new SlowRuntime("a", 10);
    const stuck = new SlowRuntime("b", 5_000);
    core.runtimes.register(quick);
    core.runtimes.register(stuck);
    const t = performance.now();
    await core.disposeRuntimes(100);
    expect(performance.now() - t).toBeLessThan(1_000);
    expect(quick.disposed).toBe(true);
    expect(stuck.disposed).toBe(false);
    core.close();
  });

  test("stopping the engine is awaitable and idempotent", async () => {
    await withTempDir(async (dir) => {
      const engine = startEngine({
        port: 0,
        demo: true,
        claudeHome: "/nonexistent",
        lookbackDays: 1,
        dataDir: dir,
        devOrigins: [],
        token: "t",
      });
      const a = engine.stop();
      expect(engine.stop()).toBe(a);
      await a;
      expect(await fetch(`http://127.0.0.1:${engine.port}/health`).catch(() => "down")).toBe(
        "down",
      );
    });
  });
});

describe("runtime file and Deep Observe hooks", () => {
  test("the engine announces itself in <dataDir>/runtime.json (0600) and takes hooks with its token", async () => {
    await withTempDir(async (dir) => {
      const dataDir = join(dir, "gravita");
      const engine = startEngine({
        port: 0,
        demo: false,
        claudeHome: join(dir, "claude"),
        lookbackDays: 1,
        dataDir,
        devOrigins: [],
        token: "engine-token",
        detectClaude: async () => ({ found: false }),
      });
      const path = join(dataDir, "runtime.json");
      const runtime = (await Bun.file(path).json()) as RuntimeFile;
      expect(runtime).toEqual({
        port: engine.port,
        hookToken: engine.hookToken,
        pid: process.pid,
        version: ENGINE_VERSION,
      });
      expect(runtime.hookToken).toMatch(/^[0-9a-f]{64}$/);
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      // Squads' worktrees get an owner-only home next to the database.
      expect((await stat(join(dataDir, "worktrees"))).mode & 0o777).toBe(0o700);

      const hook = (token: string) =>
        fetch(`http://127.0.0.1:${runtime.port}/hooks`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: "s", cwd: dir, hook_event_name: "Stop" }),
        });
      expect((await hook("engine-token")).status).toBe(401);
      expect((await hook(runtime.hookToken)).status).toBe(204);

      await engine.stop();
      expect(await Bun.file(path).exists()).toBe(false);
      // Observing never touches the Claude home.
      expect(await Bun.file(join(dir, "claude")).exists()).toBe(false);
    });
  });

  test("a demo engine never advertises itself, so hooks keep going to the real one", async () => {
    await withTempDir(async (dir) => {
      const engine = startEngine({
        port: 0,
        demo: true,
        claudeHome: join(dir, "claude"),
        lookbackDays: 1,
        dataDir: dir,
        devOrigins: [],
        token: "t",
      });
      const real = { port: 1, hookToken: "x", pid: 1, version: "0" };
      await Bun.write(join(dir, "runtime.json"), JSON.stringify(real));
      await engine.stop();
      expect(await Bun.file(join(dir, "runtime.json")).json()).toEqual(real);
    });
  });
});
