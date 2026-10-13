import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import type { ClaudeEnvironmentSource } from "../application/ports/claude-environment";
import type { Clock } from "../application/ports/clock";
import type { GitWorkspace, PullRequestHost } from "../application/ports/git-workspace";
import type { IdGenerator } from "../application/ports/id-generator";
import type { Logger } from "../application/ports/logger";
import type { ProjectDirectory } from "../application/ports/project-directory";
import type { TranscriptReader } from "../application/ports/transcript-reader";
import type { Workspace } from "../application/ports/workspace";
import { EventBroadcaster } from "../application/services/event-broadcaster";
import { HookIngest } from "../application/services/hook-ingest";
import { MergeQueue } from "../application/services/merge-queue";
import { ProjectionService } from "../application/services/projection-service";
import { InMemorySessionRuntimeRegistry } from "../application/services/session-runtime-registry";
import { SessionSettingsRecorder } from "../application/services/session-settings";
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
import { ListModels } from "../application/usecases/list-models";
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
import { type ClaudeStatus, detectClaude } from "../infrastructure/claude/claude-cli-locator";
import { DetectedClaudeEnvironment } from "../infrastructure/claude/claude-environment";
import { ClaudeHookTranslator } from "../infrastructure/claude/claude-hook-translator";
import { Registry } from "../infrastructure/claude/registry";
import {
  ClaudeSdkRuntimeFactory,
  type QueryFn,
} from "../infrastructure/claude/sdk/claude-sdk-runtime";
import { TailScheduler } from "../infrastructure/claude/tail-scheduler";
import { TranscriptDiscovery } from "../infrastructure/claude/transcript-discovery";
import { ClaudeTranscriptReader, noTranscripts } from "../infrastructure/claude/transcript-reader";
import { DemoRuntime } from "../infrastructure/demo/demo-runtime";
import { CliGitWorkspace } from "../infrastructure/git/cli-git-workspace";
import { GhCli } from "../infrastructure/git/gh-cli";
import { type Env, GitRunner } from "../infrastructure/git/git-runner";
import { SqliteCheckpointStore } from "../infrastructure/persistence/sqlite-checkpoint-store";
import { openDatabase } from "../infrastructure/persistence/sqlite-database";
import { SqliteEventStore } from "../infrastructure/persistence/sqlite-event-store";
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
  environment: ClaudeEnvironmentSource;
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
}

/**
 * M2b: the git and check building blocks of squads. Constructed and exposed for the
 * orchestration (M2c); nothing calls them yet, so the engine behaves as before.
 */
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
  transcripts?: TranscriptReader;
  /** Absent: `session.start` answers that Claude Code is unavailable (demo mode). */
  chat?: ChatOptions;
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
  /** Disposes every runtime, waiting at most `capMs` (they may still write events meanwhile). */
  disposeRuntimes(capMs?: number): Promise<void>;
  close(): void;
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
    claude: { found: false },
    indexing: { done: 0, total: 0 },
    demo: o.demo,
  });
  const ingest = new IngestEvents(events, projection, broadcaster);
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
  if (o.chat) {
    startChat = new StartChat({
      workspace: o.chat.workspace ?? new NodeWorkspace(),
      claude: o.chat.environment,
      factory: new ClaudeSdkRuntimeFactory({
        ingest,
        runtimes,
        status: broadcaster,
        clock,
        logger,
        clientApp: CLIENT_APP,
        ...(o.chat.queryFn ? { queryFn: o.chat.queryFn } : {}),
        ...(o.chat.debug ? { debug: true } : {}),
      }),
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
      getConversation: new GetConversation(o.transcripts ?? noTranscripts),
      listModels: new ListModels(runtimes, clock, logger),
      stopAll,
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
    ...(o.squad ? { squad: createSquadToolkit(o.squad, { ingest, clock }) } : {}),
    async disposeRuntimes(capMs = DISPOSE_CAP_MS) {
      await stopAll.execute(capMs);
    },
    close() {
      void hooks.close();
      broadcaster.close();
      db.close();
    },
  };
}

export interface EngineOptions extends Omit<EngineArgs, "tokenStdin"> {
  token: string;
  /** Tests pin it; otherwise 256 random bits per run. */
  hookToken?: string;
  /** Seed of the demo story. */
  demoSeed?: number;
  /** Tests replace it, so a real-mode engine doesn't look for the user's `claude`. */
  detectClaude?: () => Promise<ClaudeStatus>;
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

  // Real mode: the CLI detection runs once at start; a session started before it finished
  // waits for it. The login shell's environment is captured once and cached.
  let detection: Promise<ClaudeStatus> | undefined;
  const shellEnv = new LoginShellEnv();
  const chat: ChatOptions | undefined = opts.demo
    ? undefined
    : {
        environment: new DetectedClaudeEnvironment(
          () => detection ?? Promise.resolve({ found: false }),
          () => shellEnv.load(),
        ),
        debug: process.env.GRAVITA_DEBUG === "1",
      };

  const core = createCore({
    dbPath,
    demo: opts.demo,
    ...(chat ? { chat } : {}),
    ...(opts.demo
      ? {}
      : {
          transcripts: new ClaudeTranscriptReader({ claudeHome: opts.claudeHome }),
          squad: {
            worktreesRoot,
            // A Dock-launched app lacks the profile's PATH; checks need it to find pnpm & co.
            checkEnv: async () => ({ ...process.env, ...(await shellEnv.load()) }),
          },
        }),
  });
  // Previews of transcripts live here: owner-only.
  if (!opts.demo) chmodSync(dbPath, 0o600);
  const { clock, logger, broadcaster, ingest, projection, runtimes } = core;
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
    const tails = new TailScheduler({
      discovery: new TranscriptDiscovery({
        claudeHome: opts.claudeHome,
        lookbackDays: opts.lookbackDays,
        clock,
        isLive: registry.isLive,
      }),
      ingest,
      checkpoints: core.checkpoints,
      projects: core.projects,
      status: broadcaster,
      clock,
      logger,
      isLive: registry.isLive,
      ownership: runtimes,
    });
    registry.start();
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
      () => tails.stop(),
      () => clearInterval(drainTimer),
    );
    detection = (opts.detectClaude ?? detectClaude)()
      .then((claude) => {
        broadcaster.updateStatus({ claude });
        // Warm the environment cache so the first session doesn't wait for the shell.
        if (claude.found) shellEnv.load().catch(() => {});
        return claude;
      })
      .catch((err): ClaudeStatus => {
        logger.log("claude detection failed", err);
        return { found: false };
      });
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
