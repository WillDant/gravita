import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { GravitaState } from "@gravita/core";
import { EngineStatus, EventsNotification, GravitaEvent, RPC_VERSION } from "@gravita/protocol";
import type { Subprocess } from "bun";
import { TestClient } from "./helpers";

const MAIN = join(import.meta.dir, "../src/main.ts");
const DEV_ORIGIN = "http://localhost:5173";

interface Ready {
  event: string;
  port: number;
  token?: string;
  pid: number;
}

async function readyLine(proc: Subprocess<"pipe" | "ignore", "pipe", "inherit">): Promise<Ready> {
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (!buf.includes("\n")) {
    const { value, done } = await reader.read();
    if (done) throw new Error("engine exited before it was ready");
    buf += decoder.decode(value, { stream: true });
  }
  reader.releaseLock();
  return JSON.parse(buf.slice(0, buf.indexOf("\n"))) as Ready;
}

describe("engine (demo mode, real process)", () => {
  test("token on stdin → ready → auth → snapshot → live events → session.events → exits on stdin EOF", async () => {
    const proc = Bun.spawn(
      [
        process.execPath,
        "run",
        MAIN,
        "--demo",
        "--port",
        "0",
        "--token-stdin",
        "--dev-origin",
        DEV_ORIGIN,
      ],
      { stdin: "pipe", stdout: "pipe", stderr: "inherit" },
    );
    const token = "a".repeat(64);
    proc.stdin.write(`${token}\n`);
    await proc.stdin.flush();

    const ready = await readyLine(proc);
    expect(ready.event).toBe("ready");
    expect(ready.port).toBeGreaterThan(0);
    expect(ready.pid).toBe(proc.pid);
    expect(ready.token).toBeUndefined();

    const health = await fetch(`http://127.0.0.1:${ready.port}/health`);
    expect(await health.json()).toEqual({ ok: true });

    const c = new TestClient(`ws://127.0.0.1:${ready.port}/ws`, DEV_ORIGIN);
    expect(await c.opened).toBe(true);
    expect((await c.call("auth", { token, rpcVersion: RPC_VERSION })).result).toMatchObject({
      ok: true,
    });
    const status = EngineStatus.parse((await c.call("engine.status")).result);
    expect(status.demo).toBe(true);

    const snap = (await c.call("state.snapshot")).result as { seq: number; state: GravitaState };
    expect(snap.seq).toBe(snap.state.seq);

    const batch = EventsNotification.parse(
      (await c.waitFor((n) => n.method === "events", 5_000)).params,
    );
    expect(batch.events.length).toBeGreaterThan(0);
    // The OAuth session's first tool call comes within a few seconds of the start.
    const withTool = await c.waitFor(
      (n) =>
        n.method === "events" &&
        (n.params as EventsNotification).events.some((e) => e.type === "tool.started"),
      8_000,
    );
    const sessionId = (withTool.params as EventsNotification).events.find(
      (e) => e.type === "tool.started",
    )!.sessionId!;
    expect(Object.keys(snap.state.sessions)).toContain(sessionId);

    const res = (await c.call("session.events", { sessionId })).result as { events: unknown[] };
    const events = res.events.map((e) => GravitaEvent.parse(e));
    expect(events.length).toBeGreaterThan(3);
    expect(events.every((e) => e.sessionId === sessionId)).toBe(true);
    expect(events.some((e) => e.type === "session.presence")).toBe(false);

    c.close();
    proc.stdin.end();
    const code = await Promise.race([proc.exited, Bun.sleep(5_000).then(() => "timeout")]);
    expect(code).toBe(0);
  }, 20_000);

  test("without --token-stdin, GRAVITA_TOKEN is used and printed on the ready line", async () => {
    const proc = Bun.spawn([process.execPath, "run", MAIN, "--demo", "--port", "0"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "inherit",
      env: { ...process.env, GRAVITA_TOKEN: "dev-token" },
    });
    const ready = await readyLine(proc);
    expect(ready).toEqual({ event: "ready", port: ready.port, token: "dev-token", pid: proc.pid });
    proc.kill("SIGTERM");
    expect(await proc.exited).toBe(0);
  }, 20_000);
});
