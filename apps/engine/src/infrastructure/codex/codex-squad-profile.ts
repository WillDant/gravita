import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CodexAppServerClient,
  HANDSHAKE_TIMEOUT_MS,
  type ServerNotification,
} from "@gravita/adapter-codex";
import type { AccountPlan, AgentProvider, CodexProfileStatus } from "@gravita/protocol";
import type { AgentEnvironmentSource } from "../../application/ports/agent-environment";
import type { Clock } from "../../application/ports/clock";
import type { StatusReporter } from "../../application/ports/event-publisher";
import type { Logger } from "../../application/ports/logger";
import type { CodexProfileControl, SquadProfiles } from "../../application/ports/squad-profile";
import { SquadProfileError } from "../../domain/errors";
import { filterCodexEnv } from "../system/login-shell-env";
import { type AppServerLauncher, type AppServerProcess, stopAppServer } from "./app-server-process";
import { accountStatusOf } from "./codex-account";
import { CODEX } from "./provider";

// Gravita's own Codex profile, which every Codex squad session runs in: a Codex home under
// Gravita's data folder (`<dataDir>/codex-home`, owner-only). Autonomous sessions never
// inherit the user's personal setup, and Codex reads all of it (config, MCP servers, hooks,
// plugins, login) from its home, so squads get a home of their own:
//
// - Gravita creates the folder and writes only `config.toml` there, its own minimal one
//   (below). Everything else in it is Codex's: the login it stores when the user signs in,
//   the squad sessions' rollouts.
// - The user signs in once, through Codex itself: `account/login/start {type: "chatgpt"}`
//   on an app-server running with CODEX_HOME=<profile> answers with a URL the UI opens in
//   the browser; Codex takes the localhost callback and keeps the tokens. Gravita never
//   reads them, and never touches the user's own `~/.codex` for squads.

/** The only file Gravita writes in its Codex home. */
export const CODEX_SQUAD_CONFIG = `# Written by Gravita for its squads; rewritten before each squad session.
# Squad agents run unattended, so they get nothing of a personal setup: no MCP servers
# (Gravita adds its own role tools per session), no hooks, plugins, apps or memories.
# Repositories' own .codex/ settings aren't loaded either (no project is trusted here);
# their AGENTS.md is.

[features]
hooks = false
apps = false
plugins = false
remote_plugin = false
memories = false
browser_use = false
browser_use_external = false
computer_use = false
image_generation = false
skill_mcp_dependency_install = false
tool_suggest = false

[shell_environment_policy]
# Gravita's session token for its role tools stays out of the agent's commands.
exclude = ["GRAVITA_*"]

[analytics]
enabled = false
`;

/** How long a sign-in may wait for the browser step before it is given up. */
export const SIGN_IN_TIMEOUT_MS = 10 * 60_000;

/** How long a status read is reused. */
export const PROFILE_STATUS_TTL_MS = 60_000;

/** Only OpenAI's own sign-in pages are opened in the user's browser. */
export function isSignInUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return (
      u.protocol === "https:" &&
      (host === "openai.com" ||
        host.endsWith(".openai.com") ||
        host === "chatgpt.com" ||
        host.endsWith(".chatgpt.com"))
    );
  } catch {
    return false;
  }
}

/**
 * The environment of an app-server on the profile: the login shell's allowlisted env
 * without anything that would pick another Codex home or login (CODEX_*, OPENAI_API_KEY),
 * the profile as CODEX_HOME, Gravita's marker, and `extra` (a session's role-tool token).
 */
export function codexSquadEnv(
  env: Record<string, string>,
  home: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(filterCodexEnv(env)))
    if (!k.startsWith("CODEX_") && k !== "OPENAI_API_KEY") out[k] = v;
  return { ...out, CODEX_HOME: home, GRAVITA_MANAGED: "1", ...extra };
}

export interface CodexSquadProfileDeps {
  /** `<dataDir>/codex-home`. */
  home: string;
  launch: AppServerLauncher;
  /** Codex's CLI and the login shell's env. */
  environment: AgentEnvironmentSource;
  status: StatusReporter;
  clock: Clock;
  logger: Logger;
  version: string;
  signInTimeoutMs?: number;
}

interface PendingSignIn {
  loginId: string;
  authUrl: string;
  client: CodexAppServerClient;
  proc: AppServerProcess;
  cancelTimer: () => void;
}

export class CodexSquadProfile implements CodexProfileControl, SquadProfiles {
  private last: { at: number; status: CodexProfileStatus } | undefined;
  private pending: PendingSignIn | undefined;
  private reading: Promise<CodexProfileStatus> | undefined;

  constructor(private readonly d: CodexSquadProfileDeps) {}

  get home(): string {
    return this.d.home;
  }

  /**
   * Creates the home (owner-only) and writes Gravita's config.toml when it differs. Nothing
   * else in the folder is read or written.
   */
  prepare(): void {
    mkdirSync(this.d.home, { recursive: true, mode: 0o700 });
    chmodSync(this.d.home, 0o700);
    const file = join(this.d.home, "config.toml");
    const current = existsSync(file) ? readFileSync(file, "utf8") : undefined;
    if (current !== CODEX_SQUAD_CONFIG) writeFileSync(file, CODEX_SQUAD_CONFIG, { mode: 0o600 });
    chmodSync(file, 0o600);
  }

  /** The last status known, without asking Codex. */
  current(): CodexProfileStatus | undefined {
    return this.last?.status;
  }

  async signedIn(provider: AgentProvider): Promise<boolean> {
    if (provider !== CODEX) return true;
    return (await this.status()).loggedIn;
  }

  accountPlan(provider: AgentProvider): AccountPlan | undefined {
    if (provider !== CODEX) return undefined;
    const mode = this.last?.status.authMode;
    if (mode === "apikey") return "api";
    return mode === "chatgpt" ? "limited" : undefined;
  }

  /** Reads the profile's login through a short-lived app-server (reused for a minute). */
  status(opts: { force?: boolean } = {}): Promise<CodexProfileStatus> {
    const last = this.last;
    if (this.pending && last) return Promise.resolve(last.status);
    if (!opts.force && last && this.d.clock.now() - last.at < PROFILE_STATUS_TTL_MS)
      return Promise.resolve(last.status);
    this.reading ??= this.read().finally(() => {
      this.reading = undefined;
    });
    return this.reading;
  }

  async signIn(): Promise<{ authUrl: string }> {
    // A second click while the browser step is open gets the same link.
    if (this.pending) return { authUrl: this.pending.authUrl };
    this.prepare();
    const { client, proc } = await this.connect((n) => this.notified(n));
    try {
      const res = await client.call(
        "account/login/start",
        { type: "chatgpt" },
        { timeoutMs: HANDSHAKE_TIMEOUT_MS },
      );
      if (res.type !== "chatgpt" || !isSignInUrl(res.authUrl))
        throw new SquadProfileError(CODEX, "Codex didn't answer with a ChatGPT sign-in link.");
      const cancelTimer = this.d.clock.setTimer(
        () => void this.giveUp("The sign-in took too long; try again."),
        this.d.signInTimeoutMs ?? SIGN_IN_TIMEOUT_MS,
      );
      this.pending = { loginId: res.loginId, authUrl: res.authUrl, client, proc, cancelTimer };
      this.publish({ ...(this.last?.status ?? { loggedIn: false }), signingIn: true });
      return { authUrl: res.authUrl };
    } catch (err) {
      client.close();
      await stopAppServer(proc, 2_000);
      throw err;
    }
  }

  async signOut(): Promise<void> {
    await this.giveUp();
    if (!existsSync(this.d.home)) {
      this.publish({ loggedIn: false });
      return;
    }
    const { client, proc } = await this.connect();
    try {
      await client.call("account/logout", undefined, { timeoutMs: HANDSHAKE_TIMEOUT_MS });
      this.publish({ loggedIn: false });
    } finally {
      client.close();
      await stopAppServer(proc, 2_000);
    }
  }

  /** Stops a sign-in in progress (the engine is closing, or the user signs out). */
  async close(): Promise<void> {
    await this.giveUp();
  }

  private async read(): Promise<CodexProfileStatus> {
    // A profile never prepared was never signed in to: no need to start Codex to know.
    if (!existsSync(this.d.home)) return this.publish({ loggedIn: false });
    let conn: { client: CodexAppServerClient; proc: AppServerProcess } | undefined;
    try {
      conn = await this.connect();
      const account = await conn.client.call(
        "account/read",
        {},
        { timeoutMs: HANDSHAKE_TIMEOUT_MS },
      );
      const s = accountStatusOf(account);
      return this.publish({
        loggedIn: s.loggedIn === true,
        ...(s.account?.authMode ? { authMode: s.account.authMode } : {}),
        ...(s.account?.planType ? { planType: s.account.planType } : {}),
      });
    } catch (err) {
      this.d.logger.log("reading Gravita's codex profile failed", err);
      return this.last?.status ?? { loggedIn: false };
    } finally {
      if (conn) {
        conn.client.close();
        await stopAppServer(conn.proc, 2_000);
      }
    }
  }

  /** An app-server on the profile, past its handshake. */
  private async connect(onNotification?: (n: ServerNotification) => void) {
    const env = await this.d.environment.load();
    const proc = this.d.launch({
      cliPath: env.cliPath,
      cwd: this.d.home,
      env: codexSquadEnv(env.env, this.d.home),
    });
    const client = new CodexAppServerClient(proc.transport, {
      ...(onNotification ? { onNotification } : {}),
      onProtocolError: (m) => this.d.logger.log(`codex profile: ${m}`),
      onClose: () => {
        if (this.pending?.client === client) void this.giveUp("Codex stopped during sign-in.");
      },
    });
    try {
      await client.handshake({ name: "gravita", title: "Gravita", version: this.d.version });
    } catch (err) {
      client.close();
      await stopAppServer(proc, 2_000);
      throw err;
    }
    return { client, proc };
  }

  private notified(n: ServerNotification) {
    if (n.method !== "account/login/completed") return;
    const pending = this.pending;
    if (!pending || (n.params.loginId !== null && n.params.loginId !== pending.loginId)) return;
    void (async () => {
      if (!n.params.success) {
        await this.giveUp(n.params.error ?? "The sign-in didn't finish.");
        return;
      }
      // Codex stored the login in the profile; read back only its kind and plan.
      let status: CodexProfileStatus = { loggedIn: true };
      try {
        const s = accountStatusOf(
          await pending.client.call("account/read", {}, { timeoutMs: HANDSHAKE_TIMEOUT_MS }),
        );
        status = {
          loggedIn: s.loggedIn === true,
          ...(s.account?.authMode ? { authMode: s.account.authMode } : {}),
          ...(s.account?.planType ? { planType: s.account.planType } : {}),
        };
      } catch (err) {
        this.d.logger.log("reading the codex profile after sign-in failed", err);
      }
      await this.finish(pending);
      this.publish(status);
    })();
  }

  /** Ends a pending sign-in; `error` says why it didn't succeed. */
  private async giveUp(error?: string): Promise<void> {
    const pending = this.pending;
    if (!pending) return;
    await pending.client
      .call("account/login/cancel", { loginId: pending.loginId }, { timeoutMs: 2_000 })
      .catch(() => {});
    await this.finish(pending);
    const before = this.last?.status ?? { loggedIn: false };
    const { signingIn: _, error: __, ...rest } = before;
    this.publish({ ...rest, ...(error ? { error } : {}) });
  }

  private async finish(p: PendingSignIn) {
    if (this.pending === p) this.pending = undefined;
    p.cancelTimer();
    p.client.close();
    await stopAppServer(p.proc, 2_000);
  }

  private publish(status: CodexProfileStatus): CodexProfileStatus {
    this.last = { at: this.d.clock.now(), status };
    this.d.status.updateProvider(CODEX, { squadProfile: status });
    return status;
  }
}
