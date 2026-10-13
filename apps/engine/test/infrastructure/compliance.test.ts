import { describe, expect, test } from "bun:test";
import { cp, mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { RpcErrors } from "@gravita/protocol";
import { ProviderUnavailableError } from "../../src/domain/errors";
import { DetectedClaudeEnvironment } from "../../src/infrastructure/claude/claude-environment";
import { chatEnv } from "../../src/infrastructure/claude/sdk/claude-sdk-runtime";
import { ClaudeTranscriptReader } from "../../src/infrastructure/claude/transcript-reader";
import {
  ENV_MARKER,
  filterClaudeEnv,
  isAllowedEnvKey,
  LoginShellEnv,
  parseEnv0,
} from "../../src/infrastructure/system/login-shell-env";
import { NodeWorkspace } from "../../src/infrastructure/system/node-workspace";
import { CLIENT_APP, createCore, startEngine } from "../../src/main/container";
import { FakeClock, SilentLogger } from "../fakes";
import { withTempDir } from "../helpers";
import { type ScriptedQuery, scriptedQueryFn, sdkFixture, settle } from "../sdk-fakes";

// docs/COMPLIANCE.md, enforced: Claude Code gets an allowlisted environment (no secrets of
// other tools, nothing that spoofs its identity or joins another session), and nothing is
// ever written under the Claude home.

const FIXTURE = join(import.meta.dir, "../../../../fixtures/claude/2.1.296/nested-background");
const SID = "11111111-1111-4111-8111-111111111111";

const POLLUTED: Record<string, string> = {
  PATH: "/usr/bin:/opt/homebrew/bin",
  HOME: "/Users/u",
  USER: "u",
  LANG: "en_US.UTF-8",
  LC_ALL: "en_US.UTF-8",
  SHELL: "/bin/zsh",
  TMPDIR: "/tmp/x",
  ANTHROPIC_API_KEY: "sk-ant-user-own-key",
  ANTHROPIC_BASE_URL: "https://proxy.local",
  CLAUDE_CODE_USE_BEDROCK: "1",
  AWS_PROFILE: "work",
  GOOGLE_CLOUD_PROJECT: "p",
  CLOUD_ML_REGION: "us-east5",
  VERTEX_REGION_CLAUDE_4_0_OPUS: "europe-west1",
  HTTPS_PROXY: "http://proxy:8080",
  no_proxy: "localhost",
  NODE_EXTRA_CA_CERTS: "/etc/ca.pem",
  // Never passed on:
  GITHUB_TOKEN: "ghp_secret",
  OPENAI_API_KEY: "sk-openai",
  NPM_TOKEN: "npm_secret",
  SSH_AUTH_SOCK: "/tmp/ssh.sock",
  DATABASE_URL: "postgres://u:p@h/db",
  GRAVITA_TOKEN: "engine-token",
  CLAUDECODE: "1",
  CLAUDE_CONFIG_DIR: "/elsewhere",
  CLAUDE_CODE_ENTRYPOINT: "claude-desktop",
  CLAUDE_CODE_SESSION_ID: "parent-session",
  CLAUDE_CODE_MESSAGING_SOCKET: "/tmp/cc.sock",
  CLAUDE_CODE_MESSAGING_TOKEN: "cc-token",
  CLAUDE_CODE_CHILD_SESSION: "1",
  CLAUDE_CODE_SIMPLE: "1",
  CLAUDE_CODE_USER_EMAIL: "someone@example.com",
  EMPTY_ANTHROPIC: "",
  ANTHROPIC_MODEL: "",
};

const ALLOWED = [
  "PATH",
  "HOME",
  "USER",
  "LANG",
  "LC_ALL",
  "SHELL",
  "TMPDIR",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_USE_BEDROCK",
  "AWS_PROFILE",
  "GOOGLE_CLOUD_PROJECT",
  "CLOUD_ML_REGION",
  "VERTEX_REGION_CLAUDE_4_0_OPUS",
  "HTTPS_PROXY",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
].sort();

async function treeState(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const name of await readdir(dir, { recursive: true })) {
    const st = await stat(join(dir, name));
    out.push(`${name}:${st.isDirectory() ? "dir" : st.size}:${st.mtimeMs}`);
  }
  return out.sort();
}

describe("environment allowlist", () => {
  test("only allowlisted, non-empty variables pass; host-scoped Claude Code ones never do", () => {
    expect(Object.keys(filterClaudeEnv(POLLUTED)).sort()).toEqual(ALLOWED);
    for (const k of ["CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_MESSAGING_TOKEN", "CLAUDECODE"])
      expect(isAllowedEnvKey(k)).toBe(false);
  });

  test("the env given to the SDK is the allowlist plus Gravita's two markers", () => {
    const env = chatEnv(POLLUTED, CLIENT_APP);
    expect(Object.keys(env).sort()).toEqual(
      [...ALLOWED, "GRAVITA_MANAGED", "CLAUDE_AGENT_SDK_CLIENT_APP"].sort(),
    );
    expect(env.GRAVITA_MANAGED).toBe("1");
    expect(env.CLAUDE_AGENT_SDK_CLIENT_APP).toBe(CLIENT_APP);
  });

  test("the login shell's env -0 output is parsed after the marker, junk before it ignored", async () => {
    const out = `motd line\nmore\x00${ENV_MARKER}\x00PATH=/a:/b\x00MULTI=x\ny=z\x00GITHUB_TOKEN=s\x00`;
    expect(parseEnv0(out)).toEqual({ PATH: "/a:/b", MULTI: "x\ny=z", GITHUB_TOKEN: "s" });
    expect(parseEnv0("no marker")).toEqual({});

    const ran: string[][] = [];
    const shell = new LoginShellEnv({
      shell: "/bin/zsh",
      run: async (cmd) => {
        ran.push(cmd);
        return out;
      },
    });
    expect(await shell.load()).toEqual({ PATH: "/a:/b" });
    await shell.load();
    expect(ran).toHaveLength(1);
    expect(ran[0]?.slice(0, 2)).toEqual(["/bin/zsh", "-lic"]);
    expect(ran[0]?.[2]).toContain("env -0");

    const failing = new LoginShellEnv({ run: async () => null, fallback: POLLUTED });
    expect(Object.keys(await failing.load()).sort()).toEqual(ALLOWED);
  });

  test("the CLI must be found and current", async () => {
    const env = async () => ({ PATH: "/usr/bin" });
    await expect(
      new DetectedClaudeEnvironment(async () => ({ found: false }), env).load(),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
    await expect(
      new DetectedClaudeEnvironment(
        async () => ({ found: true, path: "/c", version: "2.0.1", outdated: true }),
        env,
      ).load(),
    ).rejects.toEqual(new ProviderUnavailableError("claude", "outdated"));
    expect(
      await new DetectedClaudeEnvironment(
        async () => ({ found: true, path: "/c", version: "2.1.296", outdated: false }),
        env,
      ).load(),
    ).toEqual({
      provider: "claude",
      cliPath: "/c",
      cliVersion: "2.1.296",
      env: { PATH: "/usr/bin" },
    });
  });
});

describe("a Gravita-run session end to end (scripted SDK)", () => {
  test("session.start → stream → conversation, and the Claude home is never written", async () => {
    await withTempDir(async (root) => {
      const home = join(root, "claude");
      const projectDir = join(home, "projects", "-work-demo");
      await mkdir(projectDir, { recursive: true });
      await cp(FIXTURE, projectDir, { recursive: true });
      const cwd = join(root, "work");
      await mkdir(cwd);
      const before = await treeState(home);

      const { queryFn, queries } = scriptedQueryFn();
      const core = createCore({
        dbPath: ":memory:",
        demo: false,
        clock: new FakeClock(),
        logger: new SilentLogger(),
        projectDirectory: { resolve: async (dir) => ({ id: "p1", root: dir, name: "work" }) },
        transcripts: new ClaudeTranscriptReader({ claudeHome: home }),
        chat: {
          environment: new DetectedClaudeEnvironment(
            async () => ({ found: true, path: "/opt/claude", version: "2.1.296" }),
            async () => filterClaudeEnv(POLLUTED),
          ),
          queryFn,
          workspace: new NodeWorkspace(),
        },
      });

      expect(await core.router.dispatch("session.start", { cwd: "relative", prompt: "x" })).toEqual(
        { error: RpcErrors.invalidCwd },
      );
      const started = await core.router.dispatch("session.start", { cwd, prompt: "Map it" });
      expect(started).toMatchObject({ result: { projectId: "p1" } });
      const sessionId = (started as { result: { sessionId: string } }).result.sessionId;
      expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);

      const q = queries[0] as ScriptedQuery;
      await q.waitForPrompts(1);
      const env = q.options.env as Record<string, string>;
      expect(
        Object.keys(env).every(
          (k) =>
            isAllowedEnvKey(k) || k === "GRAVITA_MANAGED" || k === "CLAUDE_AGENT_SDK_CLIENT_APP",
        ),
      ).toBe(true);
      expect(q.options.sessionId).toBe(sessionId);
      // The event of the first message and the message sent to Claude Code share one uuid.
      const user = core.events.sessionEvents(sessionId).find((e) => e.type === "message.user");
      expect(user?.key).toBe(`user:${q.prompts[0]?.uuid}`);

      q.emit(...(sdkFixture("question") as SDKMessage[]));
      await settle();
      expect(core.projection.session(sessionId)?.costUsd).toBe(0.0123);
      expect(await core.router.dispatch("session.send", { sessionId, text: "next" })).toEqual({
        result: { ok: true },
      });
      await q.waitForPrompts(2);

      // Reading a transcript (another session's, here) is read-only.
      const conv = await core.router.dispatch("session.conversation", { sessionId: SID });
      expect((conv as { result: { messages: unknown[] } }).result.messages).toHaveLength(5);
      expect(
        await core.router.dispatch("session.conversation", { sessionId: "../../etc/passwd" }),
      ).toEqual({ result: { messages: [] } });

      await core.disposeRuntimes();
      expect(q.closed).toBe(true);
      expect(core.runtimes.all()).toEqual([]);
      core.close();
      expect(await treeState(home)).toEqual(before);
    });
  });
});

describe("Deep Observe never writes under the Claude home", () => {
  test("the plugin's hook script and the engine keep to Gravita's own folder", async () => {
    await withTempDir(async (home) => {
      const claudeHome = join(home, ".claude");
      await mkdir(join(claudeHome, "plugins", "cache"), { recursive: true });
      await Bun.write(join(claudeHome, "settings.json"), "{}");
      const before = await treeState(claudeHome);
      const script = join(import.meta.dir, "../../../../plugins/deep-observe/hooks/forward.sh");
      const hook = JSON.stringify({ session_id: SID, hook_event_name: "Stop", cwd: home });
      const run = () =>
        Bun.spawn(["/bin/sh", script], {
          stdin: new Blob([hook]),
          stdout: "ignore",
          stderr: "ignore",
          env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home },
        }).exited;

      // Engine down: the hook is spooled under ~/.gravita.
      expect(await run()).toBe(0);
      // Engine up (demo): the hook is delivered; runtime file and spool stay under its data dir.
      const engine = startEngine({
        port: 0,
        demo: true,
        claudeHome,
        lookbackDays: 1,
        dataDir: join(home, ".gravita"),
        devOrigins: [],
        token: "t",
      });
      expect(await run()).toBe(0);
      await engine.stop();

      expect(await treeState(claudeHome)).toEqual(before);
      expect((await readdir(home)).sort()).toEqual([".claude", ".gravita"]);
    });
  });
});
