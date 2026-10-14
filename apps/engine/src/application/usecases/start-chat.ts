import { DEFAULT_MODE, isModeOf } from "@gravita/core";
import {
  type AgentProvider,
  DEFAULT_PROVIDER,
  keys,
  MAIN_AGENT,
  type SessionMode,
} from "@gravita/protocol";
import { preview } from "@gravita/protocol/tools";
import { canStartChat, countChats, MAX_CHAT_SESSIONS } from "../../domain/chat-policy";
import {
  InvalidCwdError,
  InvalidSessionModeError,
  TooManySessionsError,
} from "../../domain/errors";
import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/id-generator";
import type { SessionRuntimeRegistry } from "../ports/session-runtime";
import type { Workspace } from "../ports/workspace";
import type { RuntimeFactoryRegistry } from "../services/runtime-factory-registry";
import type { SessionSettingsRecorder } from "../services/session-settings";
import type { AnnounceProject } from "./announce-project";
import type { IngestEvents } from "./ingest-events";

export interface StartChatParams {
  cwd: string;
  prompt: string;
  /** Claude Code when absent. */
  provider?: AgentProvider;
  model?: string;
  /** One of the provider's own modes; its default when absent. */
  permissionMode?: SessionMode;
}

export interface StartChatDeps {
  workspace: Workspace;
  /** The providers sessions can run on. */
  providers: RuntimeFactoryRegistry;
  runtimes: SessionRuntimeRegistry;
  projects: AnnounceProject;
  ingest: IngestEvents;
  settings: SessionSettingsRecorder;
  ids: IdGenerator;
  clock: Clock;
  maxSessions?: number;
}

/**
 * Starts a session of the chosen provider (Claude Code unless the request names another)
 * in a folder and sends its first message. The runtime is registered before the first
 * event, so the transcript tailer leaves the session to it from the start; the first
 * message's event and the message sent to the agent share one uuid, so the transcript's
 * copy of it is deduplicated.
 */
export class StartChat {
  constructor(private readonly d: StartChatDeps) {}

  async execute(p: StartChatParams): Promise<{ sessionId: string; projectId: string }> {
    const provider = p.provider ?? DEFAULT_PROVIDER;
    if (p.permissionMode !== undefined && !isModeOf(provider, p.permissionMode))
      throw new InvalidSessionModeError(provider, p.permissionMode);
    const limit = this.d.maxSessions ?? MAX_CHAT_SESSIONS;
    if (!canStartChat(countChats(this.d.runtimes.all()), limit))
      throw new TooManySessionsError(limit);
    if (!(await this.d.workspace.isDirectory(p.cwd))) throw new InvalidCwdError(p.cwd);
    const { factory, environment } = await this.d.providers.ready(provider);
    const ts = this.d.clock.iso();
    const project = await this.d.projects.execute(p.cwd, ts);
    // Checked again after the awaits: another start may have registered meanwhile.
    if (!canStartChat(countChats(this.d.runtimes.all()), limit))
      throw new TooManySessionsError(limit);

    const sessionId = this.d.ids.uuid();
    const uuid = this.d.ids.uuid();
    const permissionMode = p.permissionMode ?? DEFAULT_MODE[provider];
    const runtime = factory.create({
      sessionId,
      projectId: project.id,
      provider,
      cwd: p.cwd,
      ...(p.model ? { model: p.model } : {}),
      permissionMode,
      environment,
    });
    this.d.runtimes.register(runtime);
    try {
      const base = {
        ts,
        source: "gravita" as const,
        provider,
        projectId: project.id,
        sessionId,
      };
      this.d.ingest.execute([
        {
          ...base,
          key: keys.sessionStarted(sessionId),
          type: "session.started",
          data: {
            kind: "chat",
            cwd: p.cwd,
            ...(p.model ? { model: p.model } : {}),
            permissionMode,
            ...(environment.cliVersion ? { cliVersion: environment.cliVersion } : {}),
          },
        },
      ]);
      this.d.settings.record(
        { sessionId, projectId: project.id, provider },
        { ...(p.model ? { model: p.model } : {}), permissionMode },
      );
      this.d.ingest.execute([
        {
          ...base,
          agentId: MAIN_AGENT,
          key: keys.userMessage(uuid),
          type: "message.user",
          data: { uuid, textPreview: preview(p.prompt), origin: "gravita" },
        },
      ]);
      runtime.start();
      await runtime.send(p.prompt, uuid);
    } catch (err) {
      this.d.runtimes.unregister(sessionId);
      await runtime.dispose();
      throw err;
    }
    return { sessionId, projectId: project.id };
  }
}
