import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentProvider, ProviderCredential, ProviderStatus } from "@gravita/protocol";
import pkg from "../../package.json" with { type: "json" };
import type { AgentEnvironmentSource } from "../application/ports/agent-environment";
import type { Clock } from "../application/ports/clock";
import type { CredentialSource, CursorKeyValidator } from "../application/ports/credential-source";
import type { GitWorkspace, PullRequestHost } from "../application/ports/git-workspace";
import type { IdGenerator } from "../application/ports/id-generator";
import type { InstallerLauncher } from "../application/ports/installer-launcher";
import type { Logger } from "../application/ports/logger";
import type { ProjectDirectory } from "../application/ports/project-directory";
import type { ProviderDetector } from "../application/ports/provider-detector";
import type { ReleaseSource } from "../application/ports/release-source";
import type { ModelOption } from "../application/ports/session-runtime";
import type { ForegroundProbe, TerminalHost } from "../application/ports/terminal-host";
import type { TranscriptReader } from "../application/ports/transcript-reader";
import type { Workspace } from "../application/ports/workspace";
import { CursorKeyStatus } from "../application/services/cursor-key-status";
import { EventBroadcaster } from "../application/services/event-broadcaster";
import { HookIngest } from "../application/services/hook-ingest";
import { MergeQueue } from "../application/services/merge-queue";
import { PlanUsageMonitor } from "../application/services/plan-usage-monitor";
import { ProjectionService } from "../application/services/projection-service";
import { ReleaseChecker } from "../application/services/release-checker";
import {
  type ProviderRuntimes,
  RuntimeFactoryRegistry,
} from "../application/services/runtime-factory-registry";
import { InMemorySessionRuntimeRegistry } from "../application/services/session-runtime-registry";
import { SessionSettingsRecorder } from "../application/services/session-settings";
import { TerminalActivityWatcher } from "../application/services/terminal-activity";
import { TerminalManager } from "../application/services/terminal-manager";
import { TerminalSessionLinker } from "../application/services/terminal-session-linker";
import { TranscriptRouter } from "../application/services/transcript-router";
import { UpdateControl } from "../application/services/update-control";
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
import { GetGitInfo } from "../application/usecases/get-git-info";
import { GetSessionEvents } from "../application/usecases/get-session-events";
import { GetSnapshot } from "../application/usecases/get-snapshot";
import { IngestEvents } from "../application/usecases/ingest-events";
import { InterruptSession } from "../application/usecases/interrupt-session";
import { DEFAULT_FALLBACKS, ListModels } from "../application/usecases/list-models";
import { PrepareSquadWorkspace } from "../application/usecases/prepare-squad-workspace";
import { RegenerateShared } from "../application/usecases/regenerate-shared";
import { RemoveSession } from "../application/usecases/remove-session";
import { RespondToPermission } from "../application/usecases/respond-to-permission";
import { RunChecks } from "../application/usecases/run-checks";
import { SendMessage } from "../application/usecases/send-message";
import { SetModel } from "../application/usecases/set-model";
import { SetPermissionMode } from "../application/usecases/set-permission-mode";
import { SpawnTerminal } from "../application/usecases/spawn-terminal";
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
import {
  type AppServerLauncher,
  spawnAppServer,
  spawnStdioAgent,
} from "../infrastructure/codex/app-server-process";
import { CodexAccountProbe } from "../infrastructure/codex/codex-account-probe";
import { CodexAppServerRuntimeFactory } from "../infrastructure/codex/codex-app-server-runtime";
import { CodexDetector } from "../infrastructure/codex/codex-detector";
import { DetectedCodexEnvironment } from "../infrastructure/codex/codex-environment";
import {
  CodexPlanUsageSource,
  CodexSquadPlanUsageSource,
} from "../infrastructure/codex/codex-plan-usage";
import { CodexPresence } from "../infrastructure/codex/codex-presence";
import { CodexSessionDiscovery } from "../infrastructure/codex/codex-session-discovery";
import { CodexSessionSource } from "../infrastructure/codex/codex-session-source";
import { CodexSquadProfile } from "../infrastructure/codex/codex-squad-profile";
import { CodexTranscriptReader } from "../infrastructure/codex/codex-transcript-reader";
import { MemoryCredentialSource } from "../infrastructure/credentials/memory-credential-source";
import { CursorAcpRuntimeFactory } from "../infrastructure/cursor/cursor-acp-runtime";
import { CursorDetector } from "../infrastructure/cursor/cursor-detector";
import {
  cursorTerminalEnv,
  DetectedCursorEnvironment,
} from "../infrastructure/cursor/cursor-environment";
import { CursorCliKeyValidator } from "../infrastructure/cursor/cursor-key-validator";
import { cursorModelsCatalog } from "../infrastructure/cursor/cursor-models-catalog";
import { CursorPresence } from "../infrastructure/cursor/cursor-presence";
import { CursorSessionDiscovery } from "../infrastructure/cursor/cursor-session-discovery";
import { CursorSessionSource } from "../infrastructure/cursor/cursor-session-source";
import { RuntimeConversationReader } from "../infrastructure/cursor/runtime-conversation-reader";
import { DemoRuntime } from "../infrastructure/demo/demo-runtime";
import { CliGitWorkspace } from "../infrastructure/git/cli-git-workspace";
import { CliRepoReader } from "../infrastructure/git/cli-repo-reader";
import { GhCli } from "../infrastructure/git/gh-cli";
import { type Env, GitRunner } from "../infrastructure/git/git-runner";
import { LoopbackMcpServer } from "../infrastructure/mcp/loopback-mcp-server";
import { SqliteCheckpointStore } from "../infrastructure/persistence/sqlite-checkpoint-store";
import { openDatabase } from "../infrastructure/persistence/sqlite-database";
import { SqliteEventStore } from "../infrastructure/persistence/sqlite-event-store";
import { DmgInstaller } from "../infrastructure/releases/dmg-installer";
import { TailScheduler } from "../infrastructure/sessions/tail-scheduler";
import { FsHookSpool } from "../infrastructure/system/fs-hook-spool";
import { FsRuntimeFile } from "../infrastructure/system/fs-runtime-file";
import { GitProjectDirectory } from "../infrastructure/system/git-project-directory";
import { LoginShellEnv } from "../infrastructure/system/login-shell-env";
import { NodeWorkspace } from "../infrastructure/system/node-workspace";
import { RandomIds } from "../infrastructure/system/random-ids";
import { StderrLogger } from "../infrastructure/system/stderr-logger";
import { SystemClock } from "../infrastructure/system/system-clock";
import { BunPtyHost } from "../infrastructure/terminal/bun-pty-host";
import { providerTerminalFlags } from "../infrastructure/terminal/provider-terminal-flags";
import { PsForegroundProbe } from "../infrastructure/terminal/ps-foreground-probe";
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

/** How long shutdown waits for a sign-in to Gravita's Codex profile to stop its app-server. */
const PROFILE_CAP_MS = 3_000;

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
  /**
   * Gravita's own Codex home for squads (`<dataDir>/codex-home`); without it, no squad runs
   * on Codex.
   */
  codexSquadHome?: string;
  /** Cursor's environment; without it (or without `credentials`), sessions don't run on Cursor. */
  cursorEnvironment?: AgentEnvironmentSource;
  /** Starts `cursor-agent acp`; tests inject a scripted one. */
  cursorLaunch?: AppServerLauncher;
  /** The Cursor API key the desktop shell handed over (ADR 008). */
  credentials?: CredentialSource;
  /** Checks a Cursor key (default: `cursor-agent models`); tests replace it. */
  cursorValidator?: CursorKeyValidator;
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
  /** Where releases are listed, and how an installer is fetched; absent: no update checks. */
  releases?: { source: ReleaseSource; installer?: InstallerLauncher };
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
  /** Embedded terminals; absent: the terminal methods answer that they're unsupported. */
  terminal?: TerminalOptions;
  /** The environment `gh` runs with for `git.info` (default: the engine's). */
  ghEnv?: () => Promise<Env>;
}

export interface TerminalOptions {
  host: TerminalHost;
  /** The login shell's environment (allowlisted), captured once. */
  shellEnv: () => Promise<Record<string, string>>;
  /** The shell when the login environment names none. */
  defaultShell: string;
  /** Tells what runs in front in each shell; absent: terminals don't show their agent. */
  foreground?: ForegroundProbe;
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
  /** Gravita's role tools for Codex squad sessions; the transport serves it on `/mcp`. */
  mcp?: LoopbackMcpServer;
  /** Gravita's Codex profile for squads (real mode with Codex). */
  codexProfile?: CodexSquadProfile;
  /** The state of the Cursor key pasted in Gravita (real mode). */
  cursorKey?: CursorKeyStatus;
  /** Looks for newer releases (real mode); `startEngine` starts its schedule. */
  releaseChecker?: ReleaseChecker;
  /** Plan usage reads (real mode); `startEngine` starts its polling. */
  usage?: PlanUsageMonitor;
  /** Embedded terminals: the user's, so the kill switch leaves them; shutdown ends them. */
  terminals?: TerminalManager;
  /** Watches which agent runs in front in each shell terminal; `startEngine` starts it. */
  terminalActivity?: TerminalActivityWatcher;
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
    version: ENGINE_VERSION,
  });
  const releaseChecker = o.releases
    ? new ReleaseChecker({
        source: o.releases.source,
        status: broadcaster,
        clock,
        logger,
        current: ENGINE_VERSION,
      })
    : undefined;
  const updates =
    o.releases && releaseChecker
      ? new UpdateControl(releaseChecker, o.releases.installer ?? new DmgInstaller(ENGINE_VERSION))
      : undefined;
  const ingest = new IngestEvents(events, projection, broadcaster);
  const runtimes = new InMemorySessionRuntimeRegistry(ingest, clock);
  // Each session's conversation comes from its provider (files, rollouts, or live Cursor buffer).
  const transcripts = new TranscriptRouter(
    {
      claude: o.transcripts ?? noTranscripts,
      ...(o.codexTranscripts ? { codex: o.codexTranscripts } : {}),
      cursor: new RuntimeConversationReader(runtimes),
    },
    (id) =>
      projection.session(id)?.provider ??
      (id.startsWith("codex:") ? "codex" : id.startsWith("cursor:") ? "cursor" : undefined),
  );
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
  let mcp: LoopbackMcpServer | undefined;
  let codexProfile: CodexSquadProfile | undefined;
  let codexModels: (() => Promise<ModelOption[]>) | undefined;
  let cursorModels: (() => Promise<ModelOption[]>) | undefined;
  let cursorKey: CursorKeyStatus | undefined;
  let unwatchCursorKey: (() => void) | undefined;
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
    if (codexEnvironment && o.chat.codexSquadHome) {
      mcp = new LoopbackMcpServer({ name: "gravita", version: ENGINE_VERSION });
      codexProfile = new CodexSquadProfile({
        home: o.chat.codexSquadHome,
        launch: codexLaunch,
        environment: codexEnvironment,
        status: broadcaster,
        clock,
        logger,
        version: ENGINE_VERSION,
      });
    }
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
        ...(mcp && codexProfile ? { squad: { profile: codexProfile, mcp } } : {}),
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
    // Cursor runs chats only, with the key pasted in Gravita (ADR 008).
    const cursorEnvironment = o.chat.cursorEnvironment;
    const credentials = o.chat.credentials;
    let cursor: ProviderRuntimes | undefined;
    if (cursorEnvironment && credentials) {
      cursorKey = new CursorKeyStatus({
        credentials,
        validator: o.chat.cursorValidator ?? new CursorCliKeyValidator(cursorEnvironment),
        status: broadcaster,
        logger,
      });
      unwatchCursorKey = cursorKey.watch();
      cursorModels = () => cursorModelsCatalog(cursorEnvironment, credentials);
      cursor = {
        environment: cursorEnvironment,
        factory: new CursorAcpRuntimeFactory({
          ingest,
          runtimes,
          status: broadcaster,
          clock,
          logger,
          launch:
            o.chat.cursorLaunch ??
            spawnStdioAgent(logger, {
              name: "cursor-agent",
              command: ["acp"],
              debug: o.chat.debug === true,
              secretEnv: ["CURSOR_API_KEY"],
            }),
          version: ENGINE_VERSION,
          credentials,
          keys: cursorKey,
        }),
      };
    }
    providers = new RuntimeFactoryRegistry({
      claude: { factory: claude, environment: o.chat.environment },
      ...(codex ? { codex: { factory: codex.factory, environment: codex.environment } } : {}),
      ...(cursor ? { cursor } : {}),
    });
    usage = new PlanUsageMonitor({
      sources: [
        new ClaudePlanUsageSource({ runtimes, logger }),
        // Gravita's Codex profile first: a squad asking for Codex's reading gets its own.
        ...(codex && codexProfile
          ? [new CodexSquadPlanUsageSource({ runtimes, profile: codexProfile, logger })]
          : []),
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
        ...(codexProfile ? { profiles: codexProfile } : {}),
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

  let terminals: { spawn: SpawnTerminal; manager: TerminalManager } | undefined;
  let terminalActivity: TerminalActivityWatcher | undefined;
  if (o.terminal) {
    const manager = new TerminalManager({ host: o.terminal.host, clock, ids, logger });
    const linker = new TerminalSessionLinker(manager);
    // Sessions that start in a terminal are linked to it as they're observed.
    broadcaster.listen({ events: (n) => linker.observe(n.events) });
    broadcaster.updateStatus({ terminal: manager.supported });
    if (o.terminal.foreground)
      terminalActivity = new TerminalActivityWatcher(manager, o.terminal.foreground, logger);
    terminals = {
      manager,
      spawn: new SpawnTerminal({
        terminals: manager,
        workspace: o.chat?.workspace ?? new NodeWorkspace(),
        projects,
        shellEnv: o.terminal.shellEnv,
        defaultShell: o.terminal.defaultShell,
        homeDir: homedir,
        ...(providers ? { providers } : {}),
        ...(o.chat?.credentials ? { credentials: o.chat.credentials } : {}),
        cursorEnv: cursorTerminalEnv,
        flags: providerTerminalFlags,
        ids,
        clock,
      }),
    };
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
      removeSession: new RemoveSession(runtimes, projection, ingest, clock),
      stopAgent: new StopAgent(runtimes),
      setModel: new SetModel(runtimes, settings),
      setPermissionMode: new SetPermissionMode(runtimes, settings),
      answerQuestion: new AnswerQuestion(runtimes),
      getConversation: new GetConversation(transcripts),
      listModels: new ListModels(runtimes, clock, logger, DEFAULT_FALLBACKS, {
        ...(codexModels ? { codex: codexModels } : {}),
        ...(cursorModels ? { cursor: cursorModels } : {}),
      }),
      stopAll,
      ...(squads ? { squads } : {}),
      ...(usage ? { usage } : {}),
      ...(codexProfile ? { codexProfile } : {}),
      ...(terminals ? { terminals } : {}),
      ...(cursorKey ? { cursorKey } : {}),
      ...(updates ? { updates } : {}),
      gitInfo: new GetGitInfo({
        workspace: o.chat?.workspace ?? new NodeWorkspace(),
        repo: new CliRepoReader(new GitRunner()),
        prs: new GhCli(o.ghEnv ? { env: o.ghEnv } : {}),
      }),
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
    ...(mcp ? { mcp } : {}),
    ...(codexProfile ? { codexProfile } : {}),
    ...(cursorKey ? { cursorKey } : {}),
    ...(releaseChecker ? { releaseChecker } : {}),
    ...(terminals ? { terminals: terminals.manager } : {}),
    ...(terminalActivity ? { terminalActivity } : {}),
    homes: { codex: o.codexHome ?? join(homedir(), ".codex") },
    async disposeRuntimes(capMs = DISPOSE_CAP_MS) {
      // First: a squad must not mistake shutdown for the kill switch and record a pause.
      squads?.close();
      await stopAll.execute(capMs);
    },
    close() {
      unwatchCursorKey?.();
      usage?.stop();
      squads?.close();
      void codexProfile?.close();
      void hooks.close();
      broadcaster.close();
      db.close();
    },
  };
}

export interface EngineOptions extends Omit<EngineArgs, "tokenStdin" | "codexHome" | "cursorHome"> {
  token: string;
  /** `--codex-home`; `~/.codex` when absent. */
  codexHome?: string;
  /** `--cursor-home`; `~/.cursor` when absent. */
  cursorHome?: string;
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
  /** The Cursor API key the desktop shell hands over on stdin (none: Cursor can't start). */
  credentials?: CredentialSource;
  /** Tests replace it, so a real-mode engine doesn't look for the user's `cursor-agent`. */
  detectCursor?: () => Promise<ProviderStatus>;
  /** Tests replace it, so no real `cursor-agent acp` is started. */
  cursorLaunch?: AppServerLauncher;
  /** Tests replace it, so no real `cursor-agent models` runs. */
  cursorValidator?: CursorKeyValidator;
  /** Where releases are listed; without one the engine never looks for a newer release. */
  releaseSource?: ReleaseSource;
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
    // The key's state, checked once the CLI is found (it publishes itself).
    new CursorDetector(
      opts.detectCursor,
      opts.demo ? undefined : async () => ({ credential: await cursorCredential() }),
    ),
  ];
  const credentials = opts.credentials ?? new MemoryCredentialSource();
  const cursorCredential = async (): Promise<ProviderCredential> =>
    core.cursorKey?.check() ?? { source: "none", state: "missing" };
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
        // Squads run Codex in a home of Gravita's own, never the user's (docs/codex.md).
        codexSquadHome: join(opts.dataDir, "codex-home"),
        cursorEnvironment: new DetectedCursorEnvironment(
          () => detected("cursor"),
          () => shellEnv.load(),
        ),
        credentials,
        ...(opts.cursorLaunch ? { cursorLaunch: opts.cursorLaunch } : {}),
        ...(opts.cursorValidator ? { cursorValidator: opts.cursorValidator } : {}),
        debug,
      };

  // Cursor's chats are read from <cursorHome>: each chat's transcript and meta.json only.
  const cursorDiscovery = new CursorSessionDiscovery({
    cursorHome: opts.cursorHome ?? join(homedir(), ".cursor"),
    lookbackDays: opts.lookbackDays,
    clock,
    onSkip: (path, reason) => stderrLogger.log(`skipped ${path}: ${reason}`),
  });
  const codexDiscovery = new CodexSessionDiscovery({
    codexHome,
    lookbackDays: opts.lookbackDays,
    clock,
    onSkip: (path, reason) => stderrLogger.log(`skipped ${path}: ${reason}`),
  });
  // Squads' Codex sessions keep their rollouts in Gravita's own Codex home; the
  // Conversation lens looks there when a thread isn't in the user's.
  const squadCodexSessions = new CodexSessionDiscovery({
    codexHome: join(opts.dataDir, "codex-home"),
    lookbackDays: opts.lookbackDays,
    clock,
  });
  const core = createCore({
    dbPath,
    demo: opts.demo,
    clock,
    ...(opts.releaseSource ? { releases: { source: opts.releaseSource } } : {}),
    codexHome,
    ...(chat ? { chat } : {}),
    terminal: {
      host: new BunPtyHost(),
      shellEnv: () => shellEnv.load(),
      defaultShell: process.env.SHELL || "/bin/zsh",
      foreground: new PsForegroundProbe(),
    },
    ...(opts.demo
      ? {}
      : {
          transcripts: new ClaudeTranscriptReader({ claudeHome: opts.claudeHome }),
          codexTranscripts: new CodexTranscriptReader({
            locate: async (threadId) =>
              (await codexDiscovery.locate(threadId)) ?? squadCodexSessions.locate(threadId),
          }),
          // gh is often in Homebrew's folder, which a Dock-launched app's PATH lacks.
          ghEnv: async () => ({ ...process.env, ...(await shellEnv.load()) }),
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
        ...(core.mcp ? { mcp: core.mcp } : {}),
        ...(core.terminals ? { terminals: core.terminals } : {}),
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

  // Codex squad sessions reach their role tools on this port.
  core.mcp?.attach(server.port);

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
    const cursorPresence = new CursorPresence({ ingest, clock });
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
        new CursorSessionSource({
          discovery: cursorDiscovery,
          presence: cursorPresence,
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
    cursorPresence.start();
    tails.start();
    if (core.terminalActivity) {
      const activity = core.terminalActivity;
      activity.start();
      stops.push(() => activity.stop());
    }
    if (core.releaseChecker) {
      const releases = core.releaseChecker;
      releases.start();
      stops.push(() => releases.stop());
    }
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
      () => cursorPresence.stop(),
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
            // Whether Gravita's own Codex profile (for squads) is signed in.
            if (provider === "codex" && status.found && !status.outdated)
              void core.codexProfile?.status().catch(() => {});
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
        // A hook mid-way (resolving its project) still writes; let it, briefly. A sign-in to
        // Gravita's Codex profile stops its app-server, which must not outlive the engine.
        await Promise.all([
          core.disposeRuntimes(),
          // Terminals end with the engine: their processes must not outlive it.
          withCap(core.terminals?.disposeAll() ?? Promise.resolve(), DISPOSE_CAP_MS),
          withCap(core.hooks.close(), HOOKS_CAP_MS),
          withCap(core.codexProfile?.close() ?? Promise.resolve(), PROFILE_CAP_MS),
        ]);
        core.close();
      })();
      return stopping;
    },
  };
}
