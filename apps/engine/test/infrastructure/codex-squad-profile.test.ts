import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { type EngineStatus, RpcErrors } from "@gravita/protocol";
import {
  CODEX_SQUAD_CONFIG,
  codexSquadEnv,
  isSignInUrl,
} from "../../src/infrastructure/codex/codex-squad-profile";
import { createCore } from "../../src/main/container";
import { call } from "../codex-rpc-helpers";
import { type FakeCodex, fakeCodexLauncher } from "../codex-squad-fakes";
import { FakeClaudeEnvironment, FakeClock, SilentLogger } from "../fakes";
import { withTempDir } from "../helpers";
import { FAKE_CODEX_ENV } from "../squad-fakes";

// Gravita's own Codex profile, which squads run in: signing in once through Codex itself
// (the browser opens Codex's link; Codex keeps the tokens in the profile), its status, and
// signing out. The app-server is a fake; nothing is launched for real.

function profileCore(tmp: string, signedIn: { now: boolean }) {
  const codex = fakeCodexLauncher(async (a) => {
    a.signedIn = signedIn.now;
  });
  const home = join(tmp, "data", "codex-home");
  const core = createCore({
    dbPath: ":memory:",
    demo: false,
    clock: new FakeClock(),
    logger: new SilentLogger(),
    chat: {
      environment: new FakeClaudeEnvironment(),
      codexEnvironment: new FakeClaudeEnvironment(FAKE_CODEX_ENV),
      codexLaunch: codex.launch,
      codexSquadHome: home,
    },
  });
  const status = () => (core.broadcaster.status() as EngineStatus).providers.codex?.squadProfile;
  return { core, home, agents: codex.agents, status };
}

const waitFor = async (pred: () => boolean) => {
  const end = Date.now() + 3_000;
  while (!pred()) {
    if (Date.now() > end) throw new Error("timed out");
    await Bun.sleep(5);
  }
};

describe("Gravita's Codex profile for squads", () => {
  test("signing in: Codex's link to open, then its end as a status update", async () => {
    await withTempDir(async (tmp) => {
      const h = profileCore(tmp, { now: false });
      // Never prepared: signed out, and nothing started to know it.
      expect(await call<unknown>(h.core, "codexProfile.status")).toEqual({ loggedIn: false });
      expect(h.agents).toHaveLength(0);
      expect(existsSync(h.home)).toBe(false);

      const { authUrl } = await call<{ authUrl: string }>(h.core, "codexProfile.signIn");
      expect(authUrl).toStartWith("https://auth.openai.com/");
      expect(h.status()).toMatchObject({ loggedIn: false, signingIn: true });
      const login = h.agents.at(-1) as FakeCodex;
      expect(login.received.find((m) => m.method === "account/login/start")?.params).toEqual({
        type: "chatgpt",
      });
      // Run on the profile, never the user's Codex home or API key.
      expect(login.launch.env.CODEX_HOME).toBe(h.home);
      expect(login.launch.env.OPENAI_API_KEY).toBeUndefined();
      expect(login.launch.env.OPENAI_BASE_URL).toBe("https://proxy.local");
      expect(login.launch.cwd).toBe(h.home);
      // A second click gets the same link, without another app-server.
      expect(await call<unknown>(h.core, "codexProfile.signIn")).toEqual({ authUrl });
      expect(h.agents).toHaveLength(1);

      // Codex took the browser's callback and stored the login in the profile.
      login.completeLogin(true);
      await waitFor(() => h.status()?.loggedIn === true);
      expect(h.status()).toEqual({ loggedIn: true, authMode: "chatgpt", planType: "team" });
      await login.exited;
      // Gravita wrote only its own config.toml, owner-only.
      expect(readdirSync(h.home)).toEqual(["config.toml"]);
      expect(statSync(h.home).mode & 0o777).toBe(0o700);
      expect(await Bun.file(join(h.home, "config.toml")).text()).toBe(CODEX_SQUAD_CONFIG);
      expect(CODEX_SQUAD_CONFIG).toContain("hooks = false");
      expect(CODEX_SQUAD_CONFIG).not.toContain("[mcp_servers");

      // Signing out goes through Codex too.
      await call(h.core, "codexProfile.signOut");
      expect(h.agents.at(-1)?.received.some((m) => m.method === "account/logout")).toBe(true);
      expect(h.status()).toEqual({ loggedIn: false });
    });
  });

  test("a failed or abandoned sign-in says why; a link that isn't OpenAI's is never handed out", async () => {
    await withTempDir(async (tmp) => {
      const h = profileCore(tmp, { now: false });
      await call(h.core, "codexProfile.signIn");
      (h.agents.at(-1) as FakeCodex).completeLogin(false, "The user closed the page.");
      await waitFor(() => h.status()?.signingIn === undefined);
      expect(h.status()).toEqual({ loggedIn: false, error: "The user closed the page." });

      const codex = fakeCodexLauncher(async (a) => {
        a.authUrl = "http://evil.example/login";
      });
      const core = createCore({
        dbPath: ":memory:",
        demo: false,
        clock: new FakeClock(),
        logger: new SilentLogger(),
        chat: {
          environment: new FakeClaudeEnvironment(),
          codexEnvironment: new FakeClaudeEnvironment(FAKE_CODEX_ENV),
          codexLaunch: codex.launch,
          codexSquadHome: join(tmp, "other"),
        },
      });
      const refused = await call(core, "codexProfile.signIn").catch((e: unknown) => e);
      expect(refused).toMatchObject({
        code: RpcErrors.codexProfileSignedOut.code,
        message: "Codex didn't answer with a ChatGPT sign-in link.",
      });
      expect(await codex.agents[0]?.exited).toBeDefined();
    });
  });

  test("the status of a profile already signed in, read once and reused", async () => {
    await withTempDir(async (tmp) => {
      const h = profileCore(tmp, { now: true });
      h.core.codexProfile?.prepare();
      expect(await call<unknown>(h.core, "codexProfile.status")).toEqual({
        loggedIn: true,
        authMode: "chatgpt",
        planType: "team",
      });
      await call(h.core, "codexProfile.status");
      expect(h.agents).toHaveLength(1);
      expect(h.core.codexProfile?.accountPlan("codex")).toBe("limited");
      expect(h.core.codexProfile?.accountPlan("claude")).toBeUndefined();
    });
  });

  test("without Codex there is no profile to sign in to", async () => {
    const core = createCore({
      dbPath: ":memory:",
      demo: false,
      chat: { environment: new FakeClaudeEnvironment() },
    });
    const err = await call(core, "codexProfile.signIn").catch((e: unknown) => e);
    expect((err as { code: number }).code).toBe(RpcErrors.providerUnavailable.code);
  });

  test("only OpenAI's https pages count as a sign-in link", () => {
    expect(isSignInUrl("https://auth.openai.com/oauth/authorize?x=1")).toBe(true);
    expect(isSignInUrl("https://chatgpt.com/auth")).toBe(true);
    expect(isSignInUrl("http://auth.openai.com/")).toBe(false);
    expect(isSignInUrl("https://openai.com.evil.example/")).toBe(false);
    expect(isSignInUrl("file:///etc/passwd")).toBe(false);
    expect(isSignInUrl("not a url")).toBe(false);
  });

  test("a profile app-server's environment keeps nothing that picks another home or login", () => {
    expect(
      codexSquadEnv(
        {
          PATH: "/usr/bin",
          CODEX_HOME: "/home/u/.codex",
          CODEX_SANDBOX: "seatbelt",
          OPENAI_API_KEY: "sk-x",
          OPENAI_BASE_URL: "https://proxy",
          GITHUB_TOKEN: "ghp",
        },
        "/data/codex-home",
        { GRAVITA_MCP_TOKEN: "t" },
      ),
    ).toEqual({
      PATH: "/usr/bin",
      OPENAI_BASE_URL: "https://proxy",
      CODEX_HOME: "/data/codex-home",
      GRAVITA_MANAGED: "1",
      GRAVITA_MCP_TOKEN: "t",
    });
  });
});
