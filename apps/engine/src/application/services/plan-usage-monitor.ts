import { isCounting, isPlanSquad, meterKey, type SquadState } from "@gravita/core";
import {
  type AccountPlan,
  type AgentProvider,
  type GravitaEvent,
  keys,
  type PlanUsageLimit,
} from "@gravita/protocol";
import {
  PLAN_BASELINE_POLL_MS,
  PLAN_USAGE_MIN_GAP_MS,
  PLAN_USAGE_POLL_MS,
  SQUAD_PROVIDER,
} from "../../domain/squad-policy";
import type { Clock } from "../ports/clock";
import type { StatusReporter } from "../ports/event-publisher";
import type { Logger } from "../ports/logger";
import type { PlanUsageReading, PlanUsageSource } from "../ports/plan-usage-source";
import type { SquadReader } from "../ports/squad-reader";
import type { IngestEvents } from "../usecases/ingest-events";

// Keeps plan usage known while it matters, cheaply. Providers push some of it themselves
// (Claude's rate limit events, mapped by the runtime); the rest is read through a session
// that is already running: every few minutes while a plan squad works, more often until its
// baseline is known, and when a screen asks (at most once a minute). It never starts a
// session to read. Readings become `usage.limits` events, which the budget guard reacts to,
// and tell the provider's status whether plan limits apply to the account.

export interface PlanUsageMonitorDeps {
  sources: readonly PlanUsageSource[];
  ingest: IngestEvents;
  status: StatusReporter;
  squads: SquadReader;
  clock: Clock;
  logger: Logger;
}

export interface PlanUsageHooks {
  /** New plan usage is in the projection: check the plan squads' budgets. */
  onUsage(): void;
  /** The account turned out to have no plan limits: plan squads can't be measured. */
  onPlanUnavailable(provider: AgentProvider): void;
}

export interface RefreshOptions {
  provider?: AgentProvider;
  /** Sessions to read through first (a squad's own). */
  prefer?: readonly string[];
  /** Read even if the last read was moments ago. */
  force?: boolean;
}

export class PlanUsageMonitor {
  private hooks: PlanUsageHooks | undefined;
  private readonly lastRead = new Map<AgentProvider, number>();
  private readonly inflight = new Map<AgentProvider, Promise<PlanUsageReading | undefined>>();
  private cancelTimer: (() => void) | undefined;
  private stopped = false;
  private readonly unsubscribe: () => void;

  constructor(private readonly d: PlanUsageMonitorDeps) {
    this.unsubscribe = d.ingest.onAccepted((events) => this.accepted(events));
  }

  /** Late-bound, so the squads (created after the monitor) can react to readings. */
  bind(hooks: PlanUsageHooks) {
    this.hooks = hooks;
  }

  /** Starts reading on its own while plan squads work. */
  start() {
    this.stopped = false;
    this.schedule(PLAN_BASELINE_POLL_MS);
  }

  stop() {
    this.stopped = true;
    this.cancelTimer?.();
    this.cancelTimer = undefined;
    this.unsubscribe();
  }

  /** Whether the provider's account has plan limits, once known. */
  accountPlan(provider: AgentProvider): AccountPlan | undefined {
    return this.d.status.providerStatus(provider)?.account?.plan;
  }

  /**
   * Reads every source (or `provider`'s) through a running session, unless one was read
   * less than a minute ago. Resolves with the reading of the first source that answered.
   */
  async refresh(o: RefreshOptions = {}): Promise<PlanUsageReading | undefined> {
    let first: PlanUsageReading | undefined;
    for (const source of this.d.sources) {
      if (o.provider && source.provider !== o.provider) continue;
      const reading = await this.readOne(source, o);
      first ??= reading;
    }
    return first;
  }

  /** One round of reading for the working plan squads; schedules the next. */
  async tick(): Promise<void> {
    const working = this.d.squads.squads().filter((q) => isPlanSquad(q) && isCounting(q));
    if (working.length) {
      // Their own sessions first, newest first; any running session of the account will do.
      const prefer = working.flatMap((q) => [...q.sessionIds].reverse());
      await this.refresh({ prefer, force: true }).catch((err) =>
        this.d.logger.log("reading plan usage failed", err),
      );
    }
    const measuring = this.d.squads
      .squads()
      .some((q) => isPlanSquad(q) && isCounting(q) && !hasMeter(q));
    this.schedule(measuring ? PLAN_BASELINE_POLL_MS : PLAN_USAGE_POLL_MS);
  }

  private schedule(ms: number) {
    if (this.stopped) return;
    this.cancelTimer?.();
    this.cancelTimer = this.d.clock.setTimer(() => {
      this.cancelTimer = undefined;
      void this.tick();
    }, ms);
  }

  private readOne(source: PlanUsageSource, o: RefreshOptions) {
    const { provider } = source;
    const running = this.inflight.get(provider);
    if (running) return running;
    const last = this.lastRead.get(provider);
    if (!o.force && last !== undefined && this.d.clock.now() - last < PLAN_USAGE_MIN_GAP_MS)
      return Promise.resolve(undefined);
    const read = (async () => {
      try {
        const reading = await source.read(o.prefer);
        if (reading) {
          this.lastRead.set(provider, this.d.clock.now());
          this.record(provider, reading);
        }
        return reading;
      } catch (err) {
        this.d.logger.log(`reading ${provider} plan usage failed`, err);
        return undefined;
      } finally {
        this.inflight.delete(provider);
      }
    })();
    this.inflight.set(provider, read);
    return read;
  }

  /** A reading becomes the provider's account plan and `usage.limits` events. */
  private record(provider: AgentProvider, reading: PlanUsageReading) {
    this.setAccount(provider, reading.limited ? "limited" : "api", reading.planType);
    if (reading.limits.length)
      this.d.ingest.execute(reading.limits.map((l) => this.usageEvent(provider, l)));
    if (!reading.limited) this.hooks?.onPlanUnavailable(provider);
  }

  private usageEvent(provider: AgentProvider, l: PlanUsageLimit): GravitaEvent {
    return {
      key: keys.usageLimits(provider, l.window, l.model, `read:${this.d.clock.now()}`),
      ts: this.d.clock.iso(),
      source: "gravita",
      provider,
      projectId: "",
      type: "usage.limits",
      data: { provider, ...l },
    };
  }

  /** Readings from any source (a provider's own events too) move the budgets. */
  private accepted(events: readonly GravitaEvent[]) {
    let usage = false;
    for (const e of events) {
      if (e.type !== "usage.limits") continue;
      usage = true;
      // Only a subscription gets rate limit events: plan limits apply to this account.
      if (e.source === "sdk") this.setAccount(e.data.provider, "limited", e.data.planType);
    }
    if (usage) this.hooks?.onUsage();
  }

  private setAccount(provider: AgentProvider, plan: AccountPlan, planType?: string) {
    const before = this.d.status.providerStatus(provider);
    const account = before?.account;
    if (account?.plan === plan && (!planType || account.planType === planType)) return;
    this.d.status.updateProvider(provider, {
      account: { ...account, plan, ...(planType ? { planType } : {}) },
    });
  }
}

/** Whether a plan squad has started counting its window (its baseline is recorded). */
function hasMeter(q: SquadState): boolean {
  const window = q.budgetPlan?.window;
  return Boolean(window && q.budget.meters?.[meterKey(SQUAD_PROVIDER, window)]);
}
