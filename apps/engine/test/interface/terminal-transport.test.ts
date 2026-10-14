import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { RPC_VERSION, type TerminalInfo, type TerminalOutput } from "@gravita/protocol";
import { BunPtyHost } from "../../src/infrastructure/terminal/bun-pty-host";
import { type RunningServer, startTransport } from "../../src/interface/rpc/transport";
import { createCore, type EngineCore } from "../../src/main/container";
import { TestClient } from "../helpers";

const TOKEN = "s3cret-token";
const host = new BunPtyHost();
let core: EngineCore;
let server: RunningServer;
let url: string;

beforeAll(() => {
  core = createCore({
    dbPath: ":memory:",
    demo: true,
    terminal: {
      host,
      shellEnv: async () => ({ PATH: process.env.PATH ?? "/usr/bin:/bin", SHELL: "/bin/sh" }),
      defaultShell: "/bin/sh",
    },
  });
  server = startTransport(
    {
      router: core.router,
      feed: core.broadcaster,
      status: () => core.broadcaster.status(),
      ...(core.terminals ? { terminals: core.terminals } : {}),
    },
    { port: 0, token: TOKEN, engineVersion: "test" },
  );
  url = `ws://127.0.0.1:${server.port}/ws`;
});

afterAll(async () => {
  await core.terminals?.disposeAll();
  server.stop();
  core.close();
});

describe.skipIf(!host.supported)("terminals over the transport", () => {
  test("a shell's output and exit reach the client, and stay for a later attach", async () => {
    const client = new TestClient(url, "tauri://localhost");
    await client.opened;
    await client.call("auth", { token: TOKEN, rpcVersion: RPC_VERSION });
    expect(core.broadcaster.status().terminal).toBe(true);

    const spawned = await client.call("terminal.spawn", {
      cwd: "/tmp",
      command: "shell",
      cols: 80,
      rows: 24,
    });
    const t = spawned.result as TerminalInfo;
    expect(t).toMatchObject({ command: "shell", running: true });

    await client.call("terminal.write", {
      terminalId: t.terminalId,
      data: "echo hello-$((40+2)); exit 7\r",
    });
    await client.waitFor(
      (n) =>
        n.method === "terminal.output" && (n.params as TerminalOutput).data.includes("hello-42"),
    );
    await client.waitFor(
      (n) =>
        n.method === "terminal.update" &&
        "terminal" in (n.params as object) &&
        (n.params as { terminal: TerminalInfo }).terminal.exitCode === 7,
    );

    const attached = await client.call("terminal.attach", { terminalId: t.terminalId });
    expect((attached.result as { scrollback: string }).scrollback).toContain("hello-42");

    await client.call("terminal.kill", { terminalId: t.terminalId });
    await client.waitFor(
      (n) =>
        n.method === "terminal.update" && (n.params as { closed?: string }).closed === t.terminalId,
    );
    expect((await client.call("terminal.list")).result).toEqual({ terminals: [] });
    client.ws.close();
  });
});
