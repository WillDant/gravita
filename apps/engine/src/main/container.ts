import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentProvider, ProviderStatus } from "@gravita/protocol";
import pkg from "../../package.json" with { type: "json" };
import type { AgentEnvironmentSource } from "../application/ports/agent-environment";
import type { Clock } from "../application/ports/clock";
import type { GitWorkspace, PullRequestHost } from "../application/ports/git-workspace";
import type { IdGenerator } from "../application/ports/id-generator";
import type { Logger } from "../application/ports/logger";
import type { ProjectDirectory } from "../application/ports/project-directory";
import type { ProviderDetector } from "../application/ports/provider-detector";
import type { ModelOption } from "../application/ports/session-runtime";
import type { TranscriptReader } from "../application/ports/transcript-reader";
import type { Workspace } from "../application/ports/workspace";
import { EventBroadcaster } from "../application/services/event-broadcaster";
import { HookIngest } from "../application/services/hook-ingest";
import { MergeQueue } from "../application/services/merge-queue";
import { PlanUsageMonitor } from "../application/services/plan-usage-monitor";
import { ProjectionService } from "../application/services/projection-service";
import { RuntimeFactoryRegistry } from "../application/services/runtime-factory-registry";
import { InMemorySessionRuntimeRegistry } from "../application/services/session-runtime-registry";
import { SessionSettingsRecorder } from "../application/services/session-settings";
import { TranscriptRouter } from "../application/services/transcript-router";
import type { SquadOrchestrator } from "../application/squad/squad-orchestrator";
import { AnnounceProject } from "../application/usecases/announce-project";
import { AnswerQuestion } from "../application/usecases/answer-question";
import { CleanupSquadWorkspace } from "../application/usecases/cleanup-squad-workspace";
import { CommitTask } from "../application/usecases/commit-task";
import { DeliverSquad } from "../application/usecases/deliver-squad";
import { DrainHookSpool } from "../application/usecases/drain-hook-spool";
import { FreezeContract } from "../application/usecases/freeze-contract";
import { GetConversation } from "../application/usecases/get-conversation";
import { GetEngineStatus } from "../application/usecases/get-engine-status";
import { GetSessionEvents } from "../application/usecases/get-session-events";
import { GetSnapshot } from "../application/usecases/get-snapshot";
import { IngestEvents } from "../application/usecases/ingest-events";
import { InterruptSession } from "../application/usecases/interrupt-session";
import { DEFAULT_FALLBACKS, ListModels } from "../application/usecases/list-models";
import { PrepareSquadWorkspace } from "../application/usecases/prepare-squad-workspace";
import { RegenerateShared } from "../application/usecases/regenerate-shared";
import { RespondToPermission } from "../application/usecases/respond-to-permission";
import { RunChecks } from "../application/usecases/run-checks";
import { SendMessage } from "../application/usecases/send-message";
import { SetModel } from "../application/usecases/set-model";
import { SetPermissionMode } from "../application/usecases/set-permission-mode";
import { StartChat } from "../application/usecases/start-chat";
import { StopAgent } from "../application/usecases/stop-agent";
import { StopAllSessions } from "../application/usecases/stop-all-sessions";
import { SyncRoleBranch } from "../application/usecases/sync-role-branch";
import type { LockfileCommand } from "../domain/squad-workspace";
import { BunCheckRunner } from "../infrastructure/checks/bun-check-runner";
import { ClaudeDetector } from "../infrastructure/claude/claude-cli-locator";
import { DetectedClaudeEnvironment } from "../infrastructure/claude/claude-environment";
import { ClaudeHookTranslator } from "../infrastructure/claude/claude-hook-translator";
import { ClaudePlanUsageSource } from "../infrastructure/claude/claude-plan-usage";
import { ClaudeSessionSource } from "../infrastructure/claude/claude-session-source";
import { Registry } from "../infrastructure/claude/registry";
import {
  ClaudeSdkRuntimeFactory,
  type QueryFn,
} from "../infrastructure/claude/sdk/claude-sdk-runtime";
import { TranscriptDiscovery } from "../infrastructure/claude/transcript-discovery";
import { ClaudeTranscriptReader, noTranscripts } from "../infrastructure/claude/transcript-reader";
import { type AppServerLauncher, spawnAppServer } from "../infrastructure/codex/app-server-process";
import { CodexAccountProbe } from "../infrastructure/codex/codex-account-probe";
import { CodexAppServerRuntimeFactory } from "../infrastructure/codex/codex-app-server-runtime";
import { CodexDetector } from "../infrastructure/codex/codex-detector";
import { DetectedCodexEnvironment } from "../infrastructure/codex/codex-environment";
import { CodexPlanUsageSource } from "../infrastructure/codex/codex-plan-usage";
import { CodexPresence } from "../infrastructure/codex/codex-presence";
import { CodexSessionDiscovery } from "../infrastructure/codex/codex-session-discovery";
import { CodexSessionSource } from "../infrastructure/codex/codex-session-source";
import { CodexTranscriptReader } from "../infrastructure/codex/codex-transcript-reader";
import { DemoRuntime } from "../infrastructure/demo/demo-runtime";
import { CliGitWorkspace } from "../infrastructure/git/cli-git-workspace";
import { GhCli } from "../infrastructure/git/gh-cli";
import { type Env, GitRunner } from "../infrastructure/git/git-runner";
import { SqliteCheckpointStore } from "../infrastructure/persistence/sqlite-checkpoint-store";
import { openDatabase } from "../infrastructure/persistence/sqlite-database";
import { SqliteEventStore } from "../infrastructure/persistence/sqlite-event-store";
import { TailScheduler } from "../infrastructure/sessions/tail-scheduler";
import { FsHookSpool } from "../infrastructure/system/fs-hook-spool";
import { FsRuntimeFile } from "../infrastructure/system/fs-runtime-file";
import { GitProjectDirectory } from "../infrastructure/system/git-project-directory";
import { LoginShellEnv } from "../infrastructure/system/login-shell-env";
import { NodeWorkspace } from "../infrastructure/system/node-workspace";
import { RandomIds } from "../infrastructure/system/random-ids";
import { StderrLogger } from "../infrastructure/system/stderr-logger";
import { SystemClock } from "../infrastructure/system/system-clock";
import { createRouter, type RpcRouter, rpcHandlers } from "../interface/rpc/router";
import { startTransport } from "../interface/rpc/transport";
import type { EngineArgs } from "./args";
import { createSquadOrchestrator } from "./squads";

// The composition root: the only place that creates concrete classes and wires them.

export const ENGINE_VERSION: string = pkg.version;

/** Identifies Gravita in Claude Code's User-Agent (CLAUDE_AGENT_SDK_CLIENT_APP). */
export const CLIENT_APP = `gravita/${ENGINE_VERSION}`;

/** How long shutdown (and the kill switch) waits for the sessions Gravita runs to close. */
export const DISPOSE_CAP_MS = 3_000;

/** How often spooled Deep Observe hooks are picked up while the engine runs. */
export const SPOOL_DRAIN_MS = 30_000;

/** How long shutdown waits for the hook being ingested. */
const HOOKS_CAP_MS = 1_000;

function withCap(p: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<void>((r) => (timer = setTimeout(r, ms)))]).finally(() =>
    clearTimeout(timer),
  );
}

/** Diagnostics before and outside the core (start-up failures). */
export const stderrLogger: Logger = new StderrLogger();

/** What starting chat sessions needs (real mode only). */
export interface ChatOptions {
  /** Claude Code's environment. */
  environment: AgentEnvironmentSource;
  /** Codex's environment; without it, sessions don't run on Codex. */
  codexEnvironment?: AgentEnvironmentSource;
  /** Starts `codex app-server`; tests inject a scripted one. */
  codexLaunch?: AppServerLauncher;
  /** Codex's login, plan and models without a chat (one is made when absent). */
  codexProbe?: CodexAccountProbe;
  /** The Agent SDK's `query`; tests inject a scripted one. */
  queryFn?: QueryFn;
  /** Log Claude Code's stderr. */
  debug?: boolean;
  workspace?: Workspace;
}

/** Where squads keep their worktrees, and the environment their tools run with. */
export interface SquadOptions {
  /** `<dataDir>/worktrees`. */
  worktreesRoot: string;
  /** Base environment of git and gh (default: the engine's). */
  env?: Env;
  /** Base environment of checks, filtered through an allowlist (default: the engine's). */
  checkEnv?: () => Env | Promise<Env>;
  /** Lockfile name → regeneration command (default: LOCKFILE_COMMANDS); tests fake them. */
  lockfileCommands?: Readonly<Record<string, LockfileCommand>>;
  /** Squads with work in flight at once (default MAX_RUNNING_SQUADS). */
  maxRunning?: number;
}

/** The git and check building blocks of squads, used by the orchestration. */
export interface SquadToolkit {
  worktreesRoot: string;
  git: GitWorkspace;
  pullRequests: PullRequestHost;
  prepare: PrepareSquadWorkspace;
  commitTask: CommitTask;
  runChecks: RunChecks;
  regenerateShared: RegenerateShared;
  mergeQueue: MergeQueue;
  syncRoleBranch: SyncRoleBranch;
  freezeContract: FreezeContract;
  deliver: DeliverSquad;
  cleanup: CleanupSquadWorkspace;
}

export function createSquadToolkit(
  o: SquadOptions,
  d: { ingest: IngestEvents; clock: Clock },
): SquadToolkit {
  const { worktreesRoot } = o;
  const env = o.env ?? process.env;
  const git = new CliGitWorkspace(new GitRunner({ env }));
  const pullRequests = new GhCli({ env });
  const runner = new BunCheckRunner({ env: o.checkEnv ?? (() => process.env) });
  const runChecks = new RunChecks({ runner, ...d });
  const regenerateShared = new RegenerateShared({
    git,
    runner,
    ...(o.lockfileCommands ? { commands: o.lockfileCommands } : {}),
  });
  return {
    worktreesRoot,
    git,
    pullRequests,
    prepare: new PrepareSquadWorkspace({ git, worktreesRoot }),
    commitTask: new CommitTask({ git, ...d }),
    runChecks,
    regenerateShared,
    mergeQueue: new MergeQueue({
      git,
      runChecks,
      regenerate: regenerateShared,
      worktreesRoot,
      ...d,
    }),
    syncRoleBranch: new SyncRoleBranch({ git }),
    freezeContract: new FreezeContract({ git, worktreesRoot, ...d }),
    deliver: new DeliverSquad({ git, pullRequests, ...d }),
    cleanup: new CleanupSquadWorkspace({ git, worktreesRoot }),
  };
}

export interface CoreOptions {
  /** A file path, or ":memory:" (demo mode, tests). */
  dbPath: string;
  demo: boolean;
  clock?: Clock;
  logger?: Logger;
  ids?: IdGenerator;
  projectDirectory?: ProjectDirectory;
  /** Claude Code's transcripts, for the Conversation lens (real mode). */
  transcripts?: TranscriptReader;
  /** Codex's rollouts, for the Conversation lens of Codex sessions (real mode). */
  codexTranscripts?: TranscriptReader;
  /** Absent: `session.start` answers that the provider is unavailable (demo mode). */
  chat?: ChatOptions;
  /** Where Codex keeps its sessions (`--codex-home`); its `sessions/` is read, never written. */
  codexHome?: string;
  /** Absent: no squad toolkit (demo mode, most tests). */
  squad?: SquadOptions;
}

/** Everything behind the transport: storage, projection, broadcasting and use cases. */
export interface EngineCore {
  clock: Clock;
  logger: Logger;
  events: SqliteEventStore;
  checkpoints: SqliteCheckpointStore;
  projection: ProjectionService;
  broadcaster: EventBroadcaster;
  ingest: IngestEvents;
  runtimes: InMemorySessionRuntimeRegistry;
  projects: AnnounceProject;
  /** Deep Observe hooks of terminal sessions. */
  hooks: HookIngest;
  stopAll: StopAllSessions;
  router: RpcRouter;
  /** Squads' git and checks (real mode). */
  squad?: SquadToolkit;
  /** Runs squads (real mode with Claude Code); absent in the demo. */
  squads?: SquadOrchestrator;
  /** The providers sessions run on (real mode); absent in the demo. */
  providers?: RuntimeFactoryRegistry;
  /** Plan usage reads (real mode); `startEngine` starts its polling. */
  usage?: PlanUsageMonitor;
  /** Where each provider keeps its files, for the sources that read them. */
  homes: { codex: string };
  /** Disposes every runtime, waiting at most `capMs` (they may still write events meanwhile). */
  disposeRuntimes(capMs?: number): Promise<void>;
  close(): void;
}

/** Codex's models before any chat runs: the probe's last answer, else a probe now. */
async function codexCatalog(
  environment: AgentEnvironmentSource,
  probe: CodexAccountProbe,
): Promise<ModelOption[]> {
  if (probe.models().length) return probe.models();
  const env = await environment.load();
  return (await probe.read(env.cliPath))?.models ?? [];
}

export function createCore(o: CoreOptions): EngineCore {
  const clock = o.clock ?? new SystemClock();
  const logger = o.logger ?? stderrLogger;
  const ids = o.ids ?? new RandomIds();
  const db = openDatabase(o.dbPath);
  const events = new SqliteEventStore(db);
  const checkpoints = new SqliteCheckpointStore(db);
  const projection = new ProjectionService();
  projection.hydrate(events.allEvents(), events.maxSeq());
  const broadcaster = new EventBroadcaster(clock, {
    providers: { claude: { found: false } },
    indexing: { done: 0, total: 0 },
    demo: o.demo,
  });
  const ingest = new IngestEvents(events, projection, broadcaster);
  // Each session's conversation comes from its own provider's files.
  const transcripts = new TranscriptRouter(
    {
      claude: o.transcripts ?? noTranscripts,
      ...(o.codexTranscripts ? { codex: o.codexTranscripts } : {}),
    },
    (id) => projection.session(id)?.provider ?? (id.startsWith("codex:") ? "codex" : undefined),
  );
  const runtimes = new InMemorySessionRuntimeRegistry(ingest, clock);
  const projects = new AnnounceProject(
    o.projectDirectory ?? new GitProjectDirectory(),
    ingest,
    clock,
  );
  const settings = new SessionSettingsRecorder(ingest, clock);
  const stopAll = new StopAllSessions(runtimes, clock, logger, DISPOSE_CAP_MS);
  const hooks = new HookIngest({
    translator: new ClaudeHookTranslator(),
    ingest,
    projects,
    ownership: runtimes,
    sessions: projection,
    clock,
    logger,
  });

  let startChat: StartChat | undefined;
  let squads: SquadOrchestrator | undefined;
  let providers: RuntimeFactoryRegistry | undefined;
  let usage: PlanUsageMonitor | undefined;
  let codexModels: (() => Promise<ModelOption[]>) | undefined;
  const squadKit = o.squad ? createSquadToolkit(o.squad, { ingest, clock }) : undefined;
  if (o.chat) {
    const workspace = o.chat.workspace ?? new NodeWorkspace();
    const claude = new ClaudeSdkRuntimeFactory({
      ingest,
      runtimes,
      status: broadcaster,
      clock,
      logger,
      clientApp: CLIENT_APP,
      ...(o.chat.queryFn ? { queryFn: o.chat.queryFn } : {}),
      ...(o.chat.debug ? { debug: true } : {}),
    });
    const codexHome = o.codexHome ?? join(homedir(), ".codex");
    const codexEnvironment = o.chat.codexEnvironment;
    const codexLaunch = o.chat.codexLaunch ?? spawnAppServer(logger, o.chat.debug);
    const codex = codexEnvironment && {
      environment: codexEnvironment,
      factory: new CodexAppServerRuntimeFactory({
        ingest,
        runtimes,
        status: broadcaster,
        clock,
        logger,
        launch: codexLaunch,
        version: ENGINE_VERSION,
        codexHome,
      }),
      probe:
        o.chat.codexProbe ??
        new CodexAccountProbe({
          launch: codexLaunch,
          shellEnv: async () => (await codexEnvironment.load()).env,
          codexHome,
          version: ENGINE_VERSION,
          clock,
          logger,
        }),
    };
    codexModels = codex && (() => codexCatalog(codex.environment, codex.probe));
    providers = new RuntimeFactoryRegistry({
      claude: { factory: claude, environment: o.chat.environment },
      ...(codex ? { codex: { factory: codex.factory, environment: codex.environment } } : {}),
    });
    usage = new PlanUsageMonitor({
      sources: [
        new ClaudePlanUsageSource({ runtimes, logger }),
        ...(codex
          ? [
              new CodexPlanUsageSource({
                runtimes,
                environment: codex.environment,
                probe: codex.probe,
                status: broadcaster,
                logger,
              }),
            ]
          : []),
      ],
      ingest,
      status: broadcaster,
      squads: projection,
      clock,
      logger,
    });
    if (squadKit)
      squads = createSquadOrchestrator({
        kit: squadKit,
        providers,
        runtimes,
        ingest,
        projection,
        events,
        transcripts,
        projects,
        workspace,
        ids,
        clock,
        logger,
        settings,
        usage,
        ...(o.squad?.maxRunning ? { maxRunning: o.squad.maxRunning } : {}),
      });
    startChat = new StartChat({
      workspace,
      providers,
      runtimes,
      projects,
      ingest,
      settings,
      ids,
      clock,
    });
  }

  const router = createRouter(
    rpcHandlers({
      getSnapshot: new GetSnapshot(broadcaster, projection),
      getEngineStatus: new GetEngineStatus(broadcaster),
      getSessionEvents: new GetSessionEvents(events),
      respondToPermission: new RespondToPermission(runtimes),
      ...(startChat ? { startChat } : {}),
      sendMessage: new SendMessage(runtimes, ingest, ids, clock),
      interruptSession: new InterruptSession(runtimes),
      stopAgent: new StopAgent(runtimes),
      setModel: new SetModel(runtimes, settings),
      setPermissionMode: new SetPermissionMode(runtimes, settings),
      answerQuestion: new AnswerQuestion(runtimes),
      getConversation: new GetConversation(transcripts),
      listModels: new ListModels(
        runtimes,
        clock,
        logger,
        DEFAULT_FALLBACKS,
        codexModels ? { codex: codexModels } : {},
      ),
      stopAll,
      ...(squads ? { squads } : {}),
      ...(usage ? { usage } : {}),
    }),
    logger,
  );
  return {
    clock,
    logger,
    events,
    checkpoints,
    projection,
    broadcaster,
    ingest,
    runtimes,
    projects,
    hooks,
    stopAll,
    router,
    ...(squadKit ? { squad: squadKit } : {}),
    ...(squads ? { squads } : {}),
    ...(providers ? { providers } : {}),
    ...(usage ? { usage } : {}),
    homes: { codex: o.codexHome ?? join(homedir(), ".codex") },
    async disposeRuntimes(capMs = DISPOSE_CAP_MS) {
      // First: a squad must not mistake shutdown for the kill switch and record a pause.
      squads?.close();
      await stopAll.execute(capMs);
    },
    close() {
      usage?.stop();
      squads?.close();
      void hooks.close();
      broadcaster.close();
      db.close();
    },
  };
}

export interface EngineOptions extends Omit<EngineArgs, "tokenStdin" | "codexHome"> {
  token: string;
  /** `--codex-home`; `~/.codex` when absent. */
  codexHome?: string;
  /** Tests pin it; otherwise 256 random bits per run. */
  hookToken?: string;
  /** Seed of the demo story. */
  demoSeed?: number;
  /** Tests replace it, so a real-mode engine doesn't look for the user's `claude`. */
  detectClaude?: () => Promise<ProviderStatus>;
  /** Tests replace it, so a real-mode engine doesn't look for the user's `codex`. */
  detectCodex?: () => Promise<ProviderStatus>;
  /** Tests replace it, so no real `codex app-server` is started. */
  codexLaunch?: AppServerLauncher;
}

export interface RunningEngine {
  port: number;
  /** What Deep Observe hooks read from `<dataDir>/runtime.json`. */
  hookToken: string;
  /** Stops the sources and the transport, closes the sessions Gravita runs, then the database. */
  stop(): Promise<void>;
}

/**
 * Wires the core, the transport and the sources. Demo mode plays the scripted provider
 * into an in-memory database and never touches claudeHome; of dataDir it only writes the
 * runtime file (and leaves the hook spool to the real engine).
 */
export function startEngine(opts: EngineOptions): RunningEngine {
  let dbPath = ":memory:";
  const worktreesRoot = join(opts.dataDir, "worktrees");
  if (!opts.demo) {
    mkdirSync(opts.dataDir, { recursive: true, mode: 0o700 });
    // Squads' worktrees hold the user's code: owner-only, like the database.
    mkdirSync(worktreesRoot, { recursive: true, mode: 0o700 });
    dbPath = join(opts.dataDir, "gravita.db");
  }

  // Real mode: each provider's CLI detection runs once at start; a session started before
  // it finished waits for it. The login shell's environment is captured once and cached.
  const detections = new Map<AgentProvider, Promise<ProviderStatus>>();
  const detected = (provider: AgentProvider) =>
    detections.get(provider) ?? Promise.resolve<ProviderStatus>({ found: false });
  const shellEnv = new LoginShellEnv();
  const debug = process.env.GRAVITA_DEBUG === "1";
  // Codex's sessions are read from <codexHome>/sessions only (see docs/COMPLIANCE.md).
  const clock = new SystemClock();
  const codexHome = opts.codexHome ?? join(homedir(), ".codex");
  const codexLaunch = opts.codexLaunch ?? spawnAppServer(stderrLogger, debug);
  // Codex's login and plan, asked of a short-lived app-server (no thread): at start-up by
  // the detector, then when a screen asks for plan usage, at most once a minute.
  const codexProbe = new CodexAccountProbe({
    launch: codexLaunch,
    shellEnv: () => shellEnv.load(),
    codexHome,
    version: ENGINE_VERSION,
    clock,
    logger: stderrLogger,
  });
  const detectors: ProviderDetector[] = [
    new ClaudeDetector(opts.detectClaude),
    new CodexDetector(
      opts.detectCodex,
      opts.demo ? undefined : async (cliPath) => (await codexProbe.read(cliPath))?.status,
    ),
  ];
  const chat: ChatOptions | undefined = opts.demo
    ? undefined
    : {
        environment: new DetectedClaudeEnvironment(
          () => detected("claude"),
          () => shellEnv.load(),
        ),
        codexEnvironment: new DetectedCodexEnvironment(
          () => detected("codex"),
          () => shellEnv.load(),
        ),
        codexLaunch,
        codexProbe,
        debug,
      };

  const codexDiscovery = new CodexSessionDiscovery({
    codexHome,
    lookbackDays: opts.lookbackDays,
    clock,
    onSkip: (path, reason) => stderrLogger.log(`skipped ${path}: ${reason}`),
  });
  const core = createCore({
    dbPath,
    demo: opts.demo,
    clock,
    codexHome,
    ...(chat ? { chat } : {}),
    ...(opts.demo
      ? {}
      : {
          transcripts: new ClaudeTranscriptReader({ claudeHome: opts.claudeHome }),
          codexTranscripts: new CodexTranscriptReader({
            locate: (threadId) => codexDiscovery.locate(threadId),
          }),
          squad: {
            worktreesRoot,
            // A Dock-launched app lacks the profile's PATH; checks need it to find pnpm & co.
            checkEnv: async () => ({ ...process.env, ...(await shellEnv.load()) }),
          },
        }),
  });
  // Previews of transcripts live here: owner-only.
  if (!opts.demo) chmodSync(dbPath, 0o600);
  const { logger, broadcaster, ingest, projection, runtimes } = core;
  // Squads that were working when the engine last stopped wait, paused, for the user.
  core.squads?.recover();
  // Plan usage is read while plan squads work (through their own running sessions).
  core.usage?.start();
  const stops: (() => void)[] = [];
  // Separate from the engine token: hooks can read it from disk, the UI's token never is.
  const hookToken = opts.hookToken ?? randomBytes(32).toString("hex");

  let server: ReturnType<typeof startTransport>;
  try {
    server = startTransport(
      {
        router: core.router,
        feed: broadcaster,
        status: () => broadcaster.status(),
        hooks: core.hooks,
      },
      {
        port: opts.port,
        token: opts.token,
        hookToken,
        devOrigins: opts.devOrigins,
        engineVersion: ENGINE_VERSION,
      },
    );
  } catch (err) {
    core.close();
    throw err;
  }

  // Only a real engine advertises itself to Deep Observe hooks: a demo engine would
  // swallow the user's real sessions into a throwaway in-memory store.
  const runtimeFile = new FsRuntimeFile(opts.dataDir);
  const advertised = { port: server.port, hookToken, pid: process.pid, version: ENGINE_VERSION };
  const advertise = (write: () => void) => {
    try {
      write();
    } catch (err) {
      // Without it hooks spool to disk until an engine that can write it starts.
      logger.log("could not write the runtime file", err);
    }
  };
  if (!opts.demo) advertise(() => runtimeFile.write(advertised));

  if (opts.demo) {
    const demo = new DemoRuntime({
      seed: opts.demoSeed ?? 1,
      ingest,
      runtimes,
      sessions: projection,
      clock,
    });
    demo.start();
    stops.push(() => demo.stop());
  } else {
    const registry = new Registry({
      claudeHome: opts.claudeHome,
      ingest,
      sessions: projection,
      projects: core.projects,
      clock,
      logger,
    });
    const codexPresence = new CodexPresence({ ingest, clock });
    const tails = new TailScheduler({
      sources: [
        new ClaudeSessionSource({
          discovery: new TranscriptDiscovery({
            claudeHome: opts.claudeHome,
            lookbackDays: opts.lookbackDays,
            clock,
            isLive: registry.isLive,
          }),
          clock,
          isLive: registry.isLive,
        }),
        new CodexSessionSource({
          discovery: codexDiscovery,
          presence: codexPresence,
          clock,
          logger,
        }),
      ],
      ingest,
      checkpoints: core.checkpoints,
      projects: core.projects,
      status: broadcaster,
      clock,
      logger,
      ownership: runtimes,
    });
    registry.start();
    codexPresence.start();
    tails.start();
    const spool = new DrainHookSpool(
      new FsHookSpool(join(opts.dataDir, "spool")),
      core.hooks,
      logger,
    );
    void spool.execute();
    const drainTimer = setInterval(() => {
      // Another engine (a dev one) may have come and gone, taking the file with it.
      advertise(() => runtimeFile.writeIfMissing(advertised));
      void spool.execute();
    }, SPOOL_DRAIN_MS);
    stops.push(
      () => registry.stop(),
      () => codexPresence.stop(),
      () => tails.stop(),
      () => clearInterval(drainTimer),
    );
    for (const detector of detectors) {
      const { provider } = detector;
      detections.set(
        provider,
        detector
          .detect()
          .then((status) => {
            broadcaster.updateProvider(provider, status);
            void detector
              .account?.(status)
              .then((account) => {
                if (!account) return;
                broadcaster.updateProvider(provider, account);
                // The same read found the plan windows: publish them.
                if (account.loggedIn) void core.usage?.refresh({ provider, force: true });
              })
              .catch((err) => logger.log(`${provider} account check failed`, err));
            // Warm the environment cache so the first session doesn't wait for the shell.
            if (status.found) shellEnv.load().catch(() => {});
            return status;
          })
          .catch((err): ProviderStatus => {
            logger.log(`${provider} detection failed`, err);
            return { found: false };
          }),
      );
    }
  }

  let stopping: Promise<void> | undefined;
  return {
    port: server.port,
    hookToken,
    stop() {
      stopping ??= (async () => {
        // First, so hooks spool instead of reaching an engine that is going away.
        if (!opts.demo) runtimeFile.removeIfOwned(process.pid);
        for (const stop of stops) stop();
        server.stop();
        // A hook mid-way (resolving its project) still writes; let it, briefly.
        await Promise.all([core.disposeRuntimes(), withCap(core.hooks.close(), HOOKS_CAP_MS)]);
        core.close();
      })();
      return stopping;
    },
  };
}
