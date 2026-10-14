import { CodexAppServerClient, HANDSHAKE_TIMEOUT_MS } from "@gravita/adapter-codex";
import type { ProviderStatus } from "@gravita/protocol";
import type { Clock } from "../../application/ports/clock";
import type { Logger } from "../../application/ports/logger";
import type { PlanUsageReading } from "../../application/ports/plan-usage-source";
import type { ModelOption } from "../../application/ports/session-runtime";
import type { AppServerLauncher } from "./app-server-process";
import { stopAppServer } from "./app-server-process";
import { accountStatusOf, readingOf } from "./codex-account";
import { codexChatEnv } from "./codex-environment";

// What Codex knows about the user's account, asked without starting a chat: a short-lived
// app-server, the handshake, `account/read`, `account/rateLimits/read` and `model/list`, then
// it is closed. No thread, no turn, nothing spent; it never logs in. Answers are kept for a
// minute and concurrent asks share one app-server, so screens asking often cost one probe.

export interface CodexAccountSnapshot {
  /** `loggedIn` and `account` for the provider's status. */
  status: Partial<ProviderStatus>;
  /** Plan usage, when the account has plan windows. */
  reading?: PlanUsageReading;
  models: ModelOption[];
}

export interface CodexAccountProbeOptions {
  launch: AppServerLauncher;
  /** The login shell's allowlisted env. */
  shellEnv: () => Promise<Record<string, string>>;
  codexHome?: string;
  version: string;
  clock: Clock;
  logger: Logger;
  /** How long an answer is reused. */
  ttlMs?: number;
}

export const PROBE_TTL_MS = 60_000;

export class CodexAccountProbe {
  private last: { at: number; cliPath: string; snapshot: CodexAccountSnapshot } | undefined;
  private inflight: Promise<CodexAccountSnapshot | undefined> | undefined;

  constructor(private readonly o: CodexAccountProbeOptions) {}

  /** The account as Codex at `cliPath` reports it; undefined when the probe failed. */
  read(cliPath: string, opts: { force?: boolean } = {}): Promise<CodexAccountSnapshot | undefined> {
    const last = this.last;
    const fresh =
      last &&
      last.cliPath === cliPath &&
      this.o.clock.now() - last.at < (this.o.ttlMs ?? PROBE_TTL_MS);
    if (fresh && !opts.force) return Promise.resolve(last.snapshot);
    this.inflight ??= this.probe(cliPath).finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  /** The models of the last probe (empty before one ran). */
  models(): ModelOption[] {
    return this.last?.snapshot.models ?? [];
  }

  private async probe(cliPath: string): Promise<CodexAccountSnapshot | undefined> {
    const env = codexChatEnv(await this.o.shellEnv(), this.o.codexHome);
    const proc = this.o.launch({ cliPath, cwd: env.HOME ?? "/", env });
    const client = new CodexAppServerClient(proc.transport, {
      onProtocolError: (m) => this.o.logger.log(`codex account probe: ${m}`),
    });
    const t = { timeoutMs: HANDSHAKE_TIMEOUT_MS };
    try {
      await client.handshake({ name: "gravita", title: "Gravita", version: this.o.version });
      const account = await client.call("account/read", {}, t);
      const status = accountStatusOf(account);
      // The catalog doesn't need a login; the plan windows do.
      const models = await client
        .call("model/list", { includeHidden: false }, t)
        .then((r) =>
          r.data
            .filter((m) => !m.hidden)
            .map((m) => ({ value: m.model, displayName: m.displayName })),
        )
        .catch(() => []);
      let reading: PlanUsageReading | undefined;
      if (status.account?.plan === "api") reading = { limited: false, limits: [] };
      else if (status.loggedIn)
        reading = await client
          .call("account/rateLimits/read", {}, t)
          .then((r) => readingOf(r, this.o.clock.now()))
          .catch(() => undefined);
      if (reading?.limited)
        status.account = {
          ...status.account,
          plan: "limited",
          ...(reading.planType ? { planType: reading.planType } : {}),
        };
      const snapshot: CodexAccountSnapshot = { status, ...(reading ? { reading } : {}), models };
      this.last = { at: this.o.clock.now(), cliPath, snapshot };
      return snapshot;
    } catch (err) {
      this.o.logger.log("codex account probe failed", err);
      return undefined;
    } finally {
      client.close();
      await stopAppServer(proc, 2_000);
    }
  }
}
