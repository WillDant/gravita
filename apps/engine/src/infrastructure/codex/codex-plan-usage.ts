import type { AgentEnvironmentSource } from "../../application/ports/agent-environment";
import type { StatusReporter } from "../../application/ports/event-publisher";
import type { Logger } from "../../application/ports/logger";
import type { PlanUsageReading, PlanUsageSource } from "../../application/ports/plan-usage-source";
import type { SessionRuntimeRegistry } from "../../application/ports/session-runtime";
import type { CodexAccountProbe } from "./codex-account-probe";
import { CodexAppServerRuntime } from "./codex-app-server-runtime";
import { CODEX } from "./provider";

// Codex's plan usage: `account/rateLimits/read`, through a running chat's app-server when
// there is one, else through the account probe (a short-lived app-server with no thread,
// which costs nothing on the plan). Either way the login it finds is reported too, so a
// `codex login` done meanwhile shows up when a screen asks again.

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
    for (const rt of this.running(prefer)) {
      try {
        const reading = await rt.readPlanUsage();
        if (reading) return reading;
      } catch (err) {
        this.d.logger.log("reading codex's plan usage through a chat failed", err);
      }
    }
    const env = await this.d.environment.load().catch(() => undefined);
    if (!env) return undefined;
    // At most one probe a minute (the detector's at start-up counts).
    const snapshot = await this.d.probe.read(env.cliPath);
    if (!snapshot) return undefined;
    this.d.status.updateProvider(CODEX, snapshot.status);
    return snapshot.reading;
  }

  /** Codex chats still running, `prefer`'s first. */
  private running(prefer: readonly string[]): CodexAppServerRuntime[] {
    const all = [
      ...prefer.flatMap((id) => {
        const rt = this.d.runtimes.get(id);
        return rt ? [rt] : [];
      }),
      ...this.d.runtimes.all(),
    ];
    return [...new Set(all)].filter((rt) => rt instanceof CodexAppServerRuntime);
  }
}
