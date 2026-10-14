import type { AgentEnvironmentSource } from "../../application/ports/agent-environment";
import type { StatusReporter } from "../../application/ports/event-publisher";
import type { Logger } from "../../application/ports/logger";
import type { PlanUsageReading, PlanUsageSource } from "../../application/ports/plan-usage-source";
import type { SessionRuntimeRegistry } from "../../application/ports/session-runtime";
import type { CodexAccountProbe } from "./codex-account-probe";
import { CodexAppServerRuntime } from "./codex-app-server-runtime";
import type { CodexSquadProfile } from "./codex-squad-profile";
import { CODEX } from "./provider";

// Codex's plan usage: `account/rateLimits/read`, through a running session's app-server when
// there is one, else through a short-lived app-server with no thread (which costs nothing on
// the plan). Two accounts, read apart: the user's own Codex (their chats, else the account
// probe on their CODEX_HOME; the login it finds is reported too, so a `codex login` done
// meanwhile shows up when a screen asks again), and Gravita's Codex profile that squads run
// in (its squad sessions, else an app-server on the profile), which may be signed in to
// another ChatGPT account.

/** Codex runtimes still running, `prefer`'s first. */
function runningCodex(
  runtimes: SessionRuntimeRegistry,
  prefer: readonly string[],
): CodexAppServerRuntime[] {
  const all = [
    ...prefer.flatMap((id) => {
      const rt = runtimes.get(id);
      return rt ? [rt] : [];
    }),
    ...runtimes.all(),
  ];
  return [...new Set(all)].filter((rt) => rt instanceof CodexAppServerRuntime);
}

async function readThrough(
  runtimes: CodexAppServerRuntime[],
  logger: Logger,
): Promise<PlanUsageReading | undefined> {
  for (const rt of runtimes) {
    try {
      const reading = await rt.readPlanUsage();
      if (reading) return reading;
    } catch (err) {
      logger.log(`reading codex's plan usage through a ${rt.kind} session failed`, err);
    }
  }
  return undefined;
}

/** The user's own Codex account: what Home shows. */
export class CodexPlanUsageSource implements PlanUsageSource {
  readonly provider = CODEX;

  constructor(
    private readonly d: {
      runtimes: SessionRuntimeRegistry;
      environment: AgentEnvironmentSource;
      probe: CodexAccountProbe;
      status: StatusReporter;
      logger: Logger;
    },
  ) {}

  async read(prefer: readonly string[] = []): Promise<PlanUsageReading | undefined> {
    // Chats only: squad sessions run on Gravita's profile, maybe another account.
    const chats = runningCodex(this.d.runtimes, prefer).filter((rt) => rt.kind !== "squad");
    const through = await readThrough(chats, this.d.logger);
    if (through) return through;
    const env = await this.d.environment.load().catch(() => undefined);
    if (!env) return undefined;
    // At most one probe a minute (the detector's at start-up counts).
    const snapshot = await this.d.probe.read(env.cliPath);
    if (!snapshot) return undefined;
    this.d.status.updateProvider(CODEX, snapshot.status);
    return snapshot.reading;
  }
}

/** Gravita's Codex profile: what a Codex squad's budget counts. */
export class CodexSquadPlanUsageSource implements PlanUsageSource {
  readonly provider = CODEX;
  readonly account = "squadProfile" as const;

  constructor(
    private readonly d: {
      runtimes: SessionRuntimeRegistry;
      profile: Pick<CodexSquadProfile, "readPlanUsage">;
      logger: Logger;
    },
  ) {}

  async read(prefer: readonly string[] = []): Promise<PlanUsageReading | undefined> {
    const squads = runningCodex(this.d.runtimes, prefer).filter((rt) => rt.kind === "squad");
    return (await readThrough(squads, this.d.logger)) ?? this.d.profile.readPlanUsage();
  }
}
