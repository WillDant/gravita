import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import type { Clock } from "../application/ports/clock";
import type { Logger } from "../application/ports/logger";
import { EventBroadcaster } from "../application/services/event-broadcaster";
import { ProjectionService } from "../application/services/projection-service";
import { InMemorySessionRuntimeRegistry } from "../application/services/session-runtime-registry";
import { AnnounceProject } from "../application/usecases/announce-project";
import { GetEngineStatus } from "../application/usecases/get-engine-status";
import { GetSessionEvents } from "../application/usecases/get-session-events";
import { GetSnapshot } from "../application/usecases/get-snapshot";
import { IngestEvents } from "../application/usecases/ingest-events";
import { RespondToPermission } from "../application/usecases/respond-to-permission";
import { detectClaude } from "../infrastructure/claude/claude-cli-locator";
import { Registry } from "../infrastructure/claude/registry";
import { TailScheduler } from "../infrastructure/claude/tail-scheduler";
import { TranscriptDiscovery } from "../infrastructure/claude/transcript-discovery";
import { DemoRuntime } from "../infrastructure/demo/demo-runtime";
import { SqliteCheckpointStore } from "../infrastructure/persistence/sqlite-checkpoint-store";
import { openDatabase } from "../infrastructure/persistence/sqlite-database";
import { SqliteEventStore } from "../infrastructure/persistence/sqlite-event-store";
import { GitProjectDirectory } from "../infrastructure/system/git-project-directory";
import { StderrLogger } from "../infrastructure/system/stderr-logger";
import { SystemClock } from "../infrastructure/system/system-clock";
import { createRouter, type RpcRouter, rpcHandlers } from "../interface/rpc/router";
import { startTransport } from "../interface/rpc/transport";
import type { EngineArgs } from "./args";

// The composition root: the only place that creates concrete classes and wires them.

export const ENGINE_VERSION: string = pkg.version;

/** Diagnostics before and outside the core (start-up failures). */
export const stderrLogger: Logger = new StderrLogger();

export interface CoreOptions {
  /** A file path, or ":memory:" (demo mode, tests). */
  dbPath: string;
  demo: boolean;
  clock?: Clock;
  logger?: Logger;
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
  router: RpcRouter;
  close(): void;
}

export function createCore(o: CoreOptions): EngineCore {
  const clock = o.clock ?? new SystemClock();
  const logger = o.logger ?? stderrLogger;
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
  const router = createRouter(
    rpcHandlers({
      getSnapshot: new GetSnapshot(broadcaster, projection),
      getEngineStatus: new GetEngineStatus(broadcaster),
      getSessionEvents: new GetSessionEvents(events),
      respondToPermission: new RespondToPermission(runtimes),
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
    router,
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
  stop(): void;
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
  const core = createCore({ dbPath, demo: opts.demo });
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
    const projects = new AnnounceProject(new GitProjectDirectory(), ingest, clock);
    const registry = new Registry({
      claudeHome: opts.claudeHome,
      ingest,
      sessions: projection,
      projects,
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
      projects,
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
    detectClaude()
      .then((claude) => broadcaster.updateStatus({ claude }))
      .catch((err) => logger.log("claude detection failed", err));
  }

  let stopped = false;
  return {
    port: server.port,
    stop() {
      if (stopped) return;
      stopped = true;
      for (const stop of stops) stop();
      for (const runtime of runtimes.all()) {
        runtime.dispose().catch((err) => logger.log("runtime dispose failed", err));
      }
      server.stop();
      core.close();
    },
  };
}
