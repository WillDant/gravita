import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import type { ClaudeEnvironmentSource } from "../application/ports/claude-environment";
import type { Clock } from "../application/ports/clock";
import type { IdGenerator } from "../application/ports/id-generator";
import type { Logger } from "../application/ports/logger";
import type { ProjectDirectory } from "../application/ports/project-directory";
import type { TranscriptReader } from "../application/ports/transcript-reader";
import type { Workspace } from "../application/ports/workspace";
import { EventBroadcaster } from "../application/services/event-broadcaster";
import { ProjectionService } from "../application/services/projection-service";
import { InMemorySessionRuntimeRegistry } from "../application/services/session-runtime-registry";
import { SessionSettingsRecorder } from "../application/services/session-settings";
import { AnnounceProject } from "../application/usecases/announce-project";
import { AnswerQuestion } from "../application/usecases/answer-question";
import { GetConversation } from "../application/usecases/get-conversation";
import { GetEngineStatus } from "../application/usecases/get-engine-status";
import { GetSessionEvents } from "../application/usecases/get-session-events";
import { GetSnapshot } from "../application/usecases/get-snapshot";
import { IngestEvents } from "../application/usecases/ingest-events";
import { InterruptSession } from "../application/usecases/interrupt-session";
import { ListModels } from "../application/usecases/list-models";
import { RespondToPermission } from "../application/usecases/respond-to-permission";
import { SendMessage } from "../application/usecases/send-message";
import { SetModel } from "../application/usecases/set-model";
import { SetPermissionMode } from "../application/usecases/set-permission-mode";
import { StartChat } from "../application/usecases/start-chat";
import { StopAgent } from "../application/usecases/stop-agent";
import { type ClaudeStatus, detectClaude } from "../infrastructure/claude/claude-cli-locator";
import { DetectedClaudeEnvironment } from "../infrastructure/claude/claude-environment";
import { Registry } from "../infrastructure/claude/registry";
import {
  ClaudeSdkRuntimeFactory,
  type QueryFn,
} from "../infrastructure/claude/sdk/claude-sdk-runtime";
import { TailScheduler } from "../infrastructure/claude/tail-scheduler";
import { TranscriptDiscovery } from "../infrastructure/claude/transcript-discovery";
import { ClaudeTranscriptReader, noTranscripts } from "../infrastructure/claude/transcript-reader";
import { DemoRuntime } from "../infrastructure/demo/demo-runtime";
import { SqliteCheckpointStore } from "../infrastructure/persistence/sqlite-checkpoint-store";
import { openDatabase } from "../infrastructure/persistence/sqlite-database";
import { SqliteEventStore } from "../infrastructure/persistence/sqlite-event-store";
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

/** How long shutdown waits for the sessions Gravita runs to close. */
export const DISPOSE_CAP_MS = 3_000;

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
  router: RpcRouter;
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
    router,
    async disposeRuntimes(capMs = DISPOSE_CAP_MS) {
      const all = runtimes
        .all()
        .map((r) => r.dispose().catch((err) => logger.log("runtime dispose failed", err)));
      if (!all.length) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.allSettled(all),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, capMs);
        }),
      ]);
      clearTimeout(timer);
    },
    close() {
      broadcaster.close();
      db.close();
    },
  };
}

export interface EngineOptions extends Omit<EngineArgs, "tokenStdin"> {
  token: string;
  /** Seed of the demo story. */
  demoSeed?: number;
}

export interface RunningEngine {
  port: number;
  /** Stops the sources and the transport, closes the sessions Gravita runs, then the database. */
  stop(): Promise<void>;
}

/**
 * Wires the core, the transport and the sources. Demo mode plays the scripted provider
 * into an in-memory database and never touches claudeHome or dataDir.
 */
export function startEngine(opts: EngineOptions): RunningEngine {
  let dbPath = ":memory:";
  if (!opts.demo) {
    mkdirSync(opts.dataDir, { recursive: true, mode: 0o700 });
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
      : { transcripts: new ClaudeTranscriptReader({ claudeHome: opts.claudeHome }) }),
  });
  // Previews of transcripts live here: owner-only.
  if (!opts.demo) chmodSync(dbPath, 0o600);
  const { clock, logger, broadcaster, ingest, projection, runtimes } = core;
  const stops: (() => void)[] = [];

  let server: ReturnType<typeof startTransport>;
  try {
    server = startTransport(
      { router: core.router, feed: broadcaster, status: () => broadcaster.status() },
      {
        port: opts.port,
        token: opts.token,
        devOrigins: opts.devOrigins,
        engineVersion: ENGINE_VERSION,
      },
    );
  } catch (err) {
    core.close();
    throw err;
  }

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
    stops.push(
      () => registry.stop(),
      () => tails.stop(),
    );
    detection = detectClaude()
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
    stop() {
      stopping ??= (async () => {
        for (const stop of stops) stop();
        server.stop();
        await core.disposeRuntimes();
        core.close();
      })();
      return stopping;
    },
  };
}
