import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { connect } from "node:net";
import { EngineStatus, type EventsNotification, RPC_VERSION } from "@gravita/protocol";
import { type RunningServer, startTransport } from "../../src/interface/rpc/transport";
import { createCore, type EngineCore } from "../../src/main/container";
import { FakeRuntime } from "../fakes";
import { event, TestClient } from "../helpers";

const TOKEN = "s3cret-token";
const ORIGIN = "tauri://localhost";
let core: EngineCore;
let server: RunningServer;
let url: string;

beforeAll(() => {
  core = createCore({ dbPath: ":memory:", demo: true });
  server = startTransport(
    { router: core.router, feed: core.broadcaster, status: () => core.broadcaster.status() },
    {
      port: 0,
      token: TOKEN,
      devOrigins: ["http://localhost:5173"],
      engineVersion: "test",
      authTimeoutMs: 300,
    },
  );
  url = `ws://127.0.0.1:${server.port}/ws`;
});

afterAll(() => {
  server.stop();
  core.close();
});

/** Raw HTTP so the Host header can be anything. */
function rawRequest(lines: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(server.port, "127.0.0.1", () =>
      socket.write(`${lines.join("\r\n")}\r\n\r\n`),
    );
    let data = "";
    socket.on("data", (d) => {
      data += d.toString();
      if (data.includes("\r\n\r\n")) {
        socket.destroy();
        resolve(data);
      }
    });
    socket.on("end", () => resolve(data));
    socket.on("error", reject);
    setTimeout(() => {
      socket.destroy();
      resolve(data);
    }, 1_000);
  });
}

describe("http", () => {
  test("health answers on an allowed Host", async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/health`);
    expect(await res.json()).toEqual({ ok: true });
    const viaLocalhost = await rawRequest([
      "GET /health HTTP/1.1",
      `Host: localhost:${server.port}`,
      "Connection: close",
    ]);
    expect(viaLocalhost.startsWith("HTTP/1.1 200")).toBe(true);
  });

  test("rejects a bad Host (DNS rebinding)", async () => {
    for (const host of [
      `evil.example:${server.port}`,
      "127.0.0.1:1",
      `127.0.0.1.nip.io:${server.port}`,
    ]) {
      const res = await rawRequest(["GET /health HTTP/1.1", `Host: ${host}`, "Connection: close"]);
      expect(res.startsWith("HTTP/1.1 403")).toBe(true);
    }
    const upgrade = await rawRequest([
      "GET /ws HTTP/1.1",
      `Host: evil.example:${server.port}`,
      "Upgrade: websocket",
      "Connection: Upgrade",
      "Sec-WebSocket-Version: 13",
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
      `Origin: ${ORIGIN}`,
    ]);
    expect(upgrade.startsWith("HTTP/1.1 403")).toBe(true);
  });
});

describe("websocket", () => {
  test("rejects a missing or foreign Origin", async () => {
    for (const origin of [undefined, "https://evil.example", "http://localhost:3000", "null"]) {
      const c = new TestClient(url, origin);
      expect(await c.opened).toBe(false);
    }
  });

  test("rejects a bad token and closes", async () => {
    const c = new TestClient(url, ORIGIN);
    expect(await c.opened).toBe(true);
    const res = await c.call("auth", { token: "wrong", rpcVersion: RPC_VERSION });
    expect(res.error?.code).toBe(4001);
    expect((await c.closed).code).toBe(4001);
  });

  test("rejects any method before auth", async () => {
    const c = new TestClient(url, ORIGIN);
    await c.opened;
    const res = await c.call("state.snapshot");
    expect(res.error?.code).toBe(4001);
    expect((await c.closed).code).toBe(4001);
  });

  test("closes a connection that never authenticates", async () => {
    const c = new TestClient(url, "http://localhost:5173");
    expect(await c.opened).toBe(true);
    expect((await c.closed).code).toBe(4001);
  });

  test("auth → snapshot → events, status and session.events", async () => {
    core.ingest.execute([event({ key: "user:before" })]);
    const c = new TestClient(url, ORIGIN);
    await c.opened;
    const auth = await c.call("auth", { token: TOKEN, rpcVersion: RPC_VERSION });
    expect(auth.result).toEqual({ ok: true, engineVersion: "test" });
    const status = await c.waitFor((n) => n.method === "engine.status");
    expect(EngineStatus.parse(status.params).demo).toBe(true);

    const snap = (await c.call("state.snapshot")).result as {
      seq: number;
      state: { sessions: Record<string, unknown> };
    };
    expect(snap.seq).toBe(1);
    expect(Object.keys(snap.state.sessions)).toEqual(["s1"]);

    core.ingest.execute([event({ key: "user:after" })]);
    const batch = await c.waitFor((n) => n.method === "events");
    const params = batch.params as EventsNotification;
    expect(params.events.map((e) => e.key)).toEqual(["user:after"]);
    expect(params.seq).toBe(2);

    const status2 = await c.call("engine.status");
    expect(EngineStatus.parse(status2.result).indexing).toEqual({ done: 0, total: 0 });
    core.broadcaster.updateStatus({ indexing: { done: 1, total: 2 } });
    await c.waitFor(
      (n) =>
        n.method === "engine.status" &&
        (n.params as { indexing: { done: number } }).indexing.done === 1,
    );

    const sessionEvents = (await c.call("session.events", { sessionId: "s1" })).result as {
      events: { key: string }[];
    };
    expect(sessionEvents.events.map((e) => e.key)).toEqual(["user:before", "user:after"]);
    expect((await c.call("session.events", {})).error?.code).toBe(-32600);
    expect((await c.call("nope")).error?.code).toBe(-32601);
    c.close();
  });
});

describe("permission.respond", () => {
  test("refuses sessions Gravita doesn't control, and answers ones it does", async () => {
    const client = new TestClient(url, ORIGIN);
    await client.opened;
    await client.call("auth", { token: TOKEN, rpcVersion: RPC_VERSION });
    const params = { sessionId: "s-perm", agentId: "main", requestId: "r1", decision: "allow" };

    const refused = await client.call("permission.respond", params);
    expect(refused.error?.code).toBe(4004);

    const runtime = new FakeRuntime("s-perm");
    core.runtimes.register(runtime);
    const ok = await client.call("permission.respond", params);
    expect(ok.result).toEqual({ ok: true });
    expect(runtime.answered).toEqual([{ agentId: "main", requestId: "r1", decision: "allow" }]);

    const bad = await client.call("permission.respond", { ...params, decision: "maybe" });
    expect(bad.error?.code).toBe(-32600);
    core.runtimes.unregister("s-perm");
    client.ws.close();
  });
});

describe("plain HTTP routes (tray kill switch, Deep Observe hooks)", () => {
  const HOOK_TOKEN = "h".repeat(64);
  let hooked: RunningServer;
  let base: string;
  const received: unknown[] = [];

  beforeAll(() => {
    hooked = startTransport(
      {
        router: core.router,
        feed: core.broadcaster,
        status: () => core.broadcaster.status(),
        hooks: { submit: (p) => received.push(p) },
      },
      { port: 0, token: TOKEN, hookToken: HOOK_TOKEN, engineVersion: "test" },
    );
    base = `http://127.0.0.1:${hooked.port}`;
  });

  afterAll(() => hooked.stop());

  const post = (path: string, init: { token?: string; body?: string; origin?: string } = {}) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
        ...(init.origin ? { Origin: init.origin } : {}),
        "Content-Type": "application/json",
      },
      ...(init.body !== undefined ? { body: init.body } : {}),
    });

  test("stop-all needs the engine token, refuses browsers, and stops Gravita's sessions", async () => {
    expect((await post("/control/stop-all")).status).toBe(401);
    expect((await post("/control/stop-all", { token: HOOK_TOKEN })).status).toBe(401);
    expect((await post("/control/stop-all", { token: TOKEN, origin: ORIGIN })).status).toBe(403);
    expect((await fetch(`${base}/control/stop-all`)).status).toBe(405);

    const a = new FakeRuntime("s-stop-a");
    const b = new FakeRuntime("s-stop-b");
    core.runtimes.register(a);
    core.runtimes.register(b);
    const res = await post("/control/stop-all", { token: TOKEN });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stopped: 2 });
    expect([a.disposed, b.disposed]).toEqual([true, true]);
    core.runtimes.unregister("s-stop-a");
    core.runtimes.unregister("s-stop-b");
  });

  test("stop-all takes the tray's raw request: Host 127.0.0.1, empty body", async () => {
    const res = await new Promise<string>((resolve, reject) => {
      const socket = connect(hooked.port, "127.0.0.1", () =>
        socket.write(
          [
            "POST /control/stop-all HTTP/1.1",
            `Host: 127.0.0.1:${hooked.port}`,
            `Authorization: Bearer ${TOKEN}`,
            "Content-Length: 0",
            "Connection: close",
            "",
            "",
          ].join("\r\n"),
        ),
      );
      let data = "";
      socket.on("data", (d) => {
        data += d.toString();
      });
      socket.on("end", () => resolve(data));
      socket.on("error", reject);
    });
    expect(res.startsWith("HTTP/1.1 200")).toBe(true);
    expect(res).toContain('{"stopped":0}');
  });

  test("hooks: token, no Origin, size and JSON are checked; a good hook is 204 at once", async () => {
    const body = JSON.stringify({ session_id: "s", hook_event_name: "Stop" });
    expect((await post("/hooks", { body })).status).toBe(401);
    expect((await post("/hooks", { body, token: "wrong" })).status).toBe(401);
    // The engine token is not the hook token.
    expect((await post("/hooks", { body, token: TOKEN })).status).toBe(401);
    expect((await post("/hooks", { body, token: HOOK_TOKEN, origin: ORIGIN })).status).toBe(403);
    expect((await post("/hooks", { body: "x".repeat(300 * 1024), token: HOOK_TOKEN })).status).toBe(
      413,
    );
    expect((await post("/hooks", { body: "{nope", token: HOOK_TOKEN })).status).toBe(400);
    expect(received).toEqual([]);

    const ok = await post("/hooks", { body, token: HOOK_TOKEN });
    expect(ok.status).toBe(204);
    // Unknown events are accepted too (and ignored later, by the ingest).
    const unknown = JSON.stringify({ session_id: "s", hook_event_name: "PreCompact" });
    expect((await post("/hooks", { body: unknown, token: HOOK_TOKEN })).status).toBe(204);
    await Bun.sleep(10);
    expect(received).toEqual([JSON.parse(body), JSON.parse(unknown)]);
  });

  test("without a hook token there is no hooks route", async () => {
    const body = JSON.stringify({ session_id: "s", hook_event_name: "Stop" });
    const res = await fetch(`http://127.0.0.1:${server.port}/hooks`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
      body,
    });
    expect(res.status).toBe(404);
  });
});
