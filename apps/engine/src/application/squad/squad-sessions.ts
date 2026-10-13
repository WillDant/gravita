import { type AgentProvider, keys, MAIN_AGENT } from "@gravita/protocol";
import { preview } from "@gravita/protocol/tools";
import { SQUAD_PROVIDER } from "../../domain/squad-policy";
import type {
  ChatRuntime,
  ChatRuntimeSpec,
  RuntimePermissionMode,
  TurnOutcome,
} from "../ports/chat-runtime";
import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/id-generator";
import type { Logger } from "../ports/logger";
import type { SessionRuntimeRegistry } from "../ports/session-runtime";
import type { RuntimeFactoryRegistry } from "../services/runtime-factory-registry";
import type { SessionSettingsRecorder } from "../services/session-settings";
import type { IngestEvents } from "../usecases/ingest-events";

// Starts and stops the sessions of squads (planner and roles), each on its provider. Like
// StartChat, the runtime is registered before its first event so the transcript tailer
// leaves it alone, and every message Gravita sends is recorded with the uuid the agent gets.

export type SquadSessionSpec = Omit<
  ChatRuntimeSpec,
  | "sessionId"
  | "projectId"
  | "provider"
  | "environment"
  | "kind"
  | "squad"
  | "resume"
  | "permissionMode"
> & {
  /** The provider the session runs on (the squad's default when absent). */
  provider?: AgentProvider;
  squadId: string;
  projectId: string;
  roleId?: string;
  taskId?: string;
  model: string;
  permissionMode: RuntimePermissionMode;
  /** The first message. */
  prompt: string;
  /** Continue this earlier session (its transcript) instead of starting a new one. */
  resumeSessionId?: string;
};

/** One squad session, as the orchestrator holds it. */
export class SquadSession {
  /** Gravita asked it to stop (pause, stop, budget): the next outcome is an interruption. */
  stopping = false;
  private ownDispose = false;
  private disposing: Promise<void> | undefined;

  constructor(
    readonly sessionId: string,
    readonly runtime: ChatRuntime,
    private readonly owner: SquadSessions,
  ) {}

  /** True when Gravita itself disposed it (anyone else doing so is the kill switch). */
  get disposedByGravita(): boolean {
    return this.ownDispose;
  }

  nextTurn(): Promise<TurnOutcome> {
    return this.runtime.nextTurn();
  }

  send(text: string): Promise<void> {
    return this.owner.send(this, text);
  }

  /**
   * Interrupts the turn; if the session hasn't let go within `graceMs`, it is disposed.
   * Returns at once: whoever waits on `nextTurn` sees how it ended.
   */
  stop(graceMs: number) {
    if (this.stopping) return;
    this.stopping = true;
    this.runtime.interrupt().catch(() => {});
    this.owner.later(() => void this.dispose(), graceMs);
  }

  /** Stops it now, without waiting for the turn: the squad is being stopped. */
  close(): Promise<void> {
    this.stopping = true;
    return this.dispose();
  }

  dispose(): Promise<void> {
    this.ownDispose = true;
    this.disposing ??= this.runtime.dispose().catch((err) => this.owner.log(err));
    return this.disposing;
  }
}

export class SquadSessions {
  constructor(
    private readonly d: {
      providers: RuntimeFactoryRegistry;
      runtimes: SessionRuntimeRegistry;
      ingest: IngestEvents;
      ids: IdGenerator;
      clock: Clock;
      logger: Logger;
      settings: SessionSettingsRecorder;
    },
  ) {}

  async start(spec: SquadSessionSpec): Promise<SquadSession> {
    const { squadId, roleId, taskId, prompt, resumeSessionId, ...rest } = spec;
    const { provider, factory, environment } = await this.d.providers.ready(
      spec.provider ?? SQUAD_PROVIDER,
    );
    const sessionId = resumeSessionId ?? this.d.ids.uuid();
    const runtime = factory.create({
      ...rest,
      sessionId,
      provider,
      environment,
      kind: "squad",
      squad: { squadId, ...(roleId ? { roleId } : {}), ...(taskId ? { taskId } : {}) },
      ...(resumeSessionId ? { resume: true } : {}),
    });
    const session = new SquadSession(sessionId, runtime, this);
    this.d.runtimes.register(runtime);
    try {
      this.d.ingest.execute([
        {
          ts: this.d.clock.iso(),
          source: "gravita",
          provider,
          projectId: spec.projectId,
          sessionId,
          key: keys.sessionStarted(sessionId),
          type: "session.started",
          data: {
            kind: "squad",
            cwd: spec.cwd,
            model: spec.model,
            permissionMode: spec.permissionMode,
            ...(environment.cliVersion ? { cliVersion: environment.cliVersion } : {}),
            ...(resumeSessionId ? { resumedFrom: resumeSessionId } : {}),
            squadId,
            ...(roleId ? { roleId } : {}),
            ...(taskId ? { taskId } : {}),
          },
        },
      ]);
      // The model shows on the session like a chat's; "dontAsk" is Gravita's own, not a UI mode.
      this.d.settings.record(
        { sessionId, projectId: spec.projectId, provider },
        {
          model: spec.model,
          ...(spec.permissionMode !== "dontAsk" ? { permissionMode: spec.permissionMode } : {}),
        },
      );
      runtime.start();
      await this.send(session, prompt);
    } catch (err) {
      this.d.runtimes.unregister(sessionId, runtime);
      await session.dispose();
      throw err;
    }
    return session;
  }

  /** Sends a message as Gravita (recorded in the session's conversation). */
  async send(session: SquadSession, text: string) {
    const uuid = this.d.ids.uuid();
    this.d.ingest.execute([
      {
        ts: this.d.clock.iso(),
        source: "gravita",
        provider: session.runtime.provider,
        projectId: session.runtime.projectId,
        sessionId: session.sessionId,
        agentId: MAIN_AGENT,
        key: keys.userMessage(uuid),
        type: "message.user",
        data: { uuid, textPreview: preview(text), origin: "gravita" },
      },
    ]);
    await session.runtime.send(text, uuid);
  }

  later(fn: () => void, ms: number) {
    this.d.clock.setTimer(fn, ms);
  }

  log(err: unknown) {
    this.d.logger.log("squad session dispose failed", err);
  }
}
