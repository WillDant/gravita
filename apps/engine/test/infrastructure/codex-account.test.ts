import { describe, expect, test } from "bun:test";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ScriptStep } from "@gravita/adapter-codex/testing";
import { spawnAppServer, stopAppServer } from "../../src/infrastructure/codex/app-server-process";
import { CodexAccountProbe } from "../../src/infrastructure/codex/codex-account-probe";
import { CodexDetector } from "../../src/infrastructure/codex/codex-detector";
import { codexChatEnv } from "../../src/infrastructure/codex/codex-environment";
import { ENGINE_VERSION } from "../../src/main/container";
import { PROBE_SCRIPT, ScriptedLauncher, script } from "../codex-rpc-helpers";
import { FakeClock, SilentLogger } from "../fakes";
import { withTempDir } from "../helpers";

function probeWith(...scripts: ScriptStep[][]) {
  const launcher = new ScriptedLauncher(...scripts);
  const clock = new FakeClock();
  const probe = new CodexAccountProbe({
    launch: launcher.launch,
    shellEnv: async () => ({ PATH: "/usr/bin", HOME: "/home/u" }),
    version: ENGINE_VERSION,
    clock,
    logger: new SilentLogger(),
  });
  return { probe, launcher, clock };
}

/** The probe's handshake with `account/read` answered as given (rate limits ambient). */
const accountScript = (account: unknown): ScriptStep[] => [
  ...PROBE_SCRIPT,
  { expect: { method: "account/read" }, result: account },
];

describe("Codex's account, without a chat", () => {
  test("logged in on a plan: its windows, its plan type, its models; no thread", async () => {
    const { probe, launcher } = probeWith(PROBE_SCRIPT);
    const snap = await probe.read("/opt/codex");
    expect(snap?.status).toEqual({
      loggedIn: true,
      account: { authMode: "chatgpt", planType: "plus", plan: "limited" },
    });
    expect(snap?.reading?.limits.map((l) => [l.window, l.usedPercent])).toEqual([
      ["five_hour", 12],
      ["seven_day", 30],
    ]);
    expect(snap?.models.map((m) => m.value)).toEqual(["gpt-5.5-codex", "gpt-5.5-mini"]);
    const server = launcher.servers[0]!;
    expect(server.received.map((m) => m.method).filter(Boolean)).toEqual([
      "initialize",
      "initialized",
      "account/read",
      "model/list",
      "account/rateLimits/read",
    ]);
    expect(await server.exited).toBe(0);
  });

  test("logged out: said so, and no plan read", async () => {
    const { probe, launcher } = probeWith(script("auth-error"));
    const snap = await probe.read("/opt/codex");
    expect(snap?.status).toEqual({ loggedIn: false });
    expect(snap?.reading).toBeUndefined();
    expect(launcher.servers[0]!.sent("account/rateLimits/read")).toHaveLength(0);
  });

  test("an API key: no plan limits, so budgets are dollars", async () => {
    const { probe } = probeWith(
      accountScript({ account: { type: "apiKey" }, requiresOpenaiAuth: true }),
    );
    const snap = await probe.read("/opt/codex");
    expect(snap?.status).toEqual({ loggedIn: true, account: { authMode: "apikey", plan: "api" } });
    expect(snap?.reading).toEqual({ limited: false, limits: [] });
  });

  test("the email Codex returns is never kept", async () => {
    const { probe } = probeWith(
      accountScript({
        account: { type: "chatgpt", email: "someone@example.com", planType: "pro" },
        requiresOpenaiAuth: true,
      }),
    );
    expect(JSON.stringify(await probe.read("/opt/codex"))).not.toContain("example.com");
  });

  test("answers are reused for a minute, and concurrent asks share one app-server", async () => {
    const { probe, launcher, clock } = probeWith(PROBE_SCRIPT, PROBE_SCRIPT);
    await Promise.all([probe.read("/opt/codex"), probe.read("/opt/codex")]);
    await probe.read("/opt/codex");
    expect(launcher.launches).toHaveLength(1);
    clock.advance(61_000);
    await probe.read("/opt/codex");
    expect(launcher.launches).toHaveLength(2);
  });

  test("the detector reports the CLI at once and the login after; an outdated one isn't probed", async () => {
    const { probe, launcher } = probeWith(PROBE_SCRIPT);
    const login = async (cliPath: string) => (await probe.read(cliPath))?.status;
    const found = { found: true, path: "/opt/codex", version: "0.160.0", outdated: false };
    const detector = new CodexDetector(async () => found, login);
    expect(await detector.detect()).toEqual(found);
    expect(await detector.account(found)).toMatchObject({ loggedIn: true });
    expect(await detector.account({ ...found, outdated: true })).toBeUndefined();
    expect(await detector.account({ found: false })).toBeUndefined();
    expect(launcher.launches).toHaveLength(1);
  });
});

describe("the environment of a Codex chat", () => {
  test("OpenAI's and Codex's variables pass, other secrets and a parent Codex's sandbox don't", () => {
    const env = codexChatEnv(
      {
        PATH: "/usr/bin",
        HOME: "/home/u",
        OPENAI_API_KEY: "sk-own",
        CODEX_HOME: "/home/u/.codex-work",
        CODEX_SANDBOX: "seatbelt",
        CODEX_SANDBOX_NETWORK_DISABLED: "1",
        ANTHROPIC_API_KEY: "sk-ant",
        GITHUB_TOKEN: "ghp",
      },
      "/home/u/.codex",
    );
    expect(Object.keys(env).sort()).toEqual(
      ["CODEX_HOME", "GRAVITA_MANAGED", "HOME", "OPENAI_API_KEY", "PATH"].sort(),
    );
    // The user's own CODEX_HOME wins over the one Gravita reads by default.
    expect(env.CODEX_HOME).toBe("/home/u/.codex-work");
    expect(codexChatEnv({ PATH: "/usr/bin" }, "/home/u/.codex").CODEX_HOME).toBe("/home/u/.codex");
  });
});

describe("the app-server process", () => {
  test("stopping it stops what it started too (its process group)", async () => {
    await withTempDir(async (dir) => {
      // A stand-in for `codex app-server` that starts a long command and ignores its input.
      const cli = join(dir, "codex");
      const pidFile = join(dir, "child.pid");
      await writeFile(cli, `#!/bin/sh\nsleep 600 &\necho $! > "${pidFile}"\nwait\n`);
      await chmod(cli, 0o755);
      const proc = spawnAppServer(new SilentLogger())({
        cliPath: cli,
        cwd: dir,
        env: { PATH: "/usr/bin:/bin" },
      });
      let pid = 0;
      for (let i = 0; i < 200 && !pid; i++) {
        pid = Number((await readFile(pidFile, "utf8").catch(() => "")).trim());
        if (!pid) await Bun.sleep(10);
      }
      expect(pid).toBeGreaterThan(0);
      await stopAppServer(proc, 2_000);
      await proc.exited;
      let alive = true;
      for (let i = 0; i < 100 && alive; i++) {
        try {
          process.kill(pid, 0);
          await Bun.sleep(10);
        } catch {
          alive = false;
        }
      }
      expect(alive).toBe(false);
    });
  });
});
