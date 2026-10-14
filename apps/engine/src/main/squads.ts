import type { Clock } from "../application/ports/clock";
import type { EventStore } from "../application/ports/event-store";
import type { IdGenerator } from "../application/ports/id-generator";
import type { Logger } from "../application/ports/logger";
import type { SessionRuntimeRegistry } from "../application/ports/session-runtime";
import type { SquadProfiles } from "../application/ports/squad-profile";
import type { TranscriptReader } from "../application/ports/transcript-reader";
import type { Workspace } from "../application/ports/workspace";
import type { PlanUsageMonitor } from "../application/services/plan-usage-monitor";
import type { ProjectionService } from "../application/services/projection-service";
import type { RuntimeFactoryRegistry } from "../application/services/runtime-factory-registry";
import type { SessionSettingsRecorder } from "../application/services/session-settings";
import { BudgetGuard } from "../application/squad/budget-guard";
import { RunBriefing } from "../application/squad/run-briefing";
import { RunPlanner } from "../application/squad/run-planner";
import { SquadDesk } from "../application/squad/squad-desk";
import { SquadEmitter } from "../application/squad/squad-emitter";
import { SquadOrchestrator } from "../application/squad/squad-orchestrator";
import { SquadRuns } from "../application/squad/squad-run";
import { SquadScheduler } from "../application/squad/squad-scheduler";
import { SquadSessions } from "../application/squad/squad-sessions";
import { TaskRunner } from "../application/squad/task-runner";
import type { AnnounceProject } from "../application/usecases/announce-project";
import type { IngestEvents } from "../application/usecases/ingest-events";
import type { SquadToolkit } from "./container";

// Wires the squad orchestration: the desk (role tools), the task runner, the planner, the
// budget guard and the scheduler around one SquadRuns registry. Late-bound callbacks break
// the one cycle (the desk asks the scheduler to look when roles add work).

export interface SquadWiring {
  kit: SquadToolkit;
  providers: RuntimeFactoryRegistry;
  runtimes: SessionRuntimeRegistry;
  ingest: IngestEvents;
  projection: ProjectionService;
  /** The briefing's words, for a planner that can't resume it. */
  events: EventStore;
  transcripts: TranscriptReader;
  projects: AnnounceProject;
  workspace: Workspace;
  ids: IdGenerator;
  clock: Clock;
  logger: Logger;
  settings: SessionSettingsRecorder;
  /** Plan usage: plan squads' budgets react to its readings. */
  usage?: PlanUsageMonitor;
  /** Providers whose squads run in a profile of their own (Codex). */
  profiles?: SquadProfiles;
  maxRunning?: number;
}

export function createSquadOrchestrator(w: SquadWiring): SquadOrchestrator {
  const { kit, ingest, clock, logger, projection: squads } = w;
  const runs = new SquadRuns(kit.worktreesRoot);
  const emitter = new SquadEmitter({ ingest, clock, squads });
  const sessions = new SquadSessions({
    providers: w.providers,
    runtimes: w.runtimes,
    ingest,
    ids: w.ids,
    clock,
    logger,
    settings: w.settings,
  });
  const budget = new BudgetGuard({ emitter, sessions: squads, clock });
  let scheduler: SquadScheduler | undefined;
  const desk = new SquadDesk({
    squads,
    emitter,
    commitTask: kit.commitTask,
    runChecks: kit.runChecks,
    mergeQueue: kit.mergeQueue,
    git: kit.git,
    ingest,
    clock,
    attempt: (b) => runs.attempt(b),
    onWorkAdded: (squadId) => {
      const run = runs.get(squadId);
      if (run && scheduler) run.track(scheduler.advance(run));
    },
    integrationPath: (squadId) => {
      const q = squads.squad(squadId);
      return q ? runs.of(q).layout.integration.path : undefined;
    },
  });
  const runner = new TaskRunner({
    sessions,
    squads,
    git: kit.git,
    syncRoleBranch: kit.syncRoleBranch,
    emitter,
    host: desk,
    onTurn: (run) => scheduler?.onTurn(run),
  });
  scheduler = new SquadScheduler({
    squads,
    emitter,
    runner,
    budget,
    desk,
    runChecks: kit.runChecks,
    freezeContract: kit.freezeContract,
    logger,
  });
  const orchestrator = new SquadOrchestrator({
    squads,
    budget,
    ...(w.usage ? { usage: w.usage } : {}),
    ...(w.profiles ? { profiles: w.profiles } : {}),
    emitter,
    scheduler,
    planner: new RunPlanner({ sessions, squads, emitter, budget }),
    briefing: new RunBriefing({
      sessions,
      squads,
      projection: squads,
      budget,
      transcripts: w.transcripts,
      events: w.events,
      clock,
    }),
    git: kit.git,
    prepare: kit.prepare,
    deliver: kit.deliver,
    cleanup: kit.cleanup,
    projects: w.projects,
    workspace: w.workspace,
    providers: w.providers,
    ids: w.ids,
    clock,
    logger,
    runs,
    ...(w.maxRunning ? { maxRunning: w.maxRunning } : {}),
  });
  w.usage?.bind({
    onUsage: () => orchestrator.checkBudgets(),
    onPlanUnavailable: (provider, account) => orchestrator.planUnavailable(provider, account),
  });
  return orchestrator;
}
