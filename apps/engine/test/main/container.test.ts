import { describe, expect, test } from "bun:test";
import { createCore, startEngine } from "../../src/main/container";
import { FakeRuntime } from "../fakes";

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
    const engine = startEngine({
      port: 0,
      demo: true,
      claudeHome: "/nonexistent",
      lookbackDays: 1,
      dataDir: "/nonexistent",
      devOrigins: [],
      token: "t",
    });
    const a = engine.stop();
    expect(engine.stop()).toBe(a);
    await a;
    expect(await fetch(`http://127.0.0.1:${engine.port}/health`).catch(() => "down")).toBe("down");
  });
});
