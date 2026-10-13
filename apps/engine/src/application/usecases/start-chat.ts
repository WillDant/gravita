import { keys, MAIN_AGENT, type PermissionMode } from "@gravita/protocol";
import { canStartChat, MAX_CHAT_SESSIONS, previewText } from "../../domain/chat-policy";
import { InvalidCwdError, TooManySessionsError } from "../../domain/errors";
import type { ChatRuntimeFactory } from "../ports/chat-runtime";
import type { ClaudeEnvironmentSource } from "../ports/claude-environment";
import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/id-generator";
import type { SessionRuntimeRegistry } from "../ports/session-runtime";
import type { Workspace } from "../ports/workspace";
import type { SessionSettingsRecorder } from "../services/session-settings";
import type { AnnounceProject } from "./announce-project";
import type { IngestEvents } from "./ingest-events";

export interface StartChatParams {
  cwd: string;
  prompt: string;
  model?: string;
  permissionMode?: PermissionMode;
}

export interface StartChatDeps {
  workspace: Workspace;
  claude: ClaudeEnvironmentSource;
  factory: ChatRuntimeFactory;
  runtimes: SessionRuntimeRegistry;
  projects: AnnounceProject;
  ingest: IngestEvents;
  settings: SessionSettingsRecorder;
  ids: IdGenerator;
  clock: Clock;
  maxSessions?: number;
}

/**
 * Starts a Claude Code session in a folder and sends its first message. The runtime is
 * registered before the first event, so the transcript tailer leaves the session to it
 * from the start; the first message's event and the message sent to Claude Code share
 * one uuid, so the transcript's copy of it is deduplicated.
 */
export class StartChat {
  constructor(private readonly d: StartChatDeps) {}

  async execute(p: StartChatParams): Promise<{ sessionId: string; projectId: string }> {
    const limit = this.d.maxSessions ?? MAX_CHAT_SESSIONS;
    if (!canStartChat(this.d.runtimes.all().length, limit)) throw new TooManySessionsError(limit);
    if (!(await this.d.workspace.isDirectory(p.cwd))) throw new InvalidCwdError(p.cwd);
    const environment = await this.d.claude.load();
    const ts = this.d.clock.iso();
    const project = await this.d.projects.execute(p.cwd, ts);
    // Checked again after the awaits: another start may have registered meanwhile.
    if (!canStartChat(this.d.runtimes.all().length, limit)) throw new TooManySessionsError(limit);

    const sessionId = this.d.ids.uuid();
    const uuid = this.d.ids.uuid();
    const permissionMode = p.permissionMode ?? "default";
    const runtime = this.d.factory.create({
      sessionId,
      projectId: project.id,
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
        provider: "claude" as const,
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
        { sessionId, projectId: project.id, provider: "claude" },
        { ...(p.model ? { model: p.model } : {}), permissionMode },
      );
      this.d.ingest.execute([
        {
          ...base,
          agentId: MAIN_AGENT,
          key: keys.userMessage(uuid),
          type: "message.user",
          data: { uuid, textPreview: previewText(p.prompt), origin: "gravita" },
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
