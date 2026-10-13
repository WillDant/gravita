import {
  type CanUseTool,
  type Options,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
  query as sdkQuery,
} from "@anthropic-ai/claude-agent-sdk";
import { inputPreview, SdkSessionMapper } from "@gravita/adapter-claude";
import { MAIN_AGENT, type PermissionMode } from "@gravita/protocol";
import type {
  ChatRuntime,
  ChatRuntimeFactory,
  ChatRuntimeSpec,
} from "../../../application/ports/chat-runtime";
import type { Clock } from "../../../application/ports/clock";
import type { StatusReporter } from "../../../application/ports/event-publisher";
import type { Logger } from "../../../application/ports/logger";
import type {
  ModelOption,
  PermissionDecision,
  SessionRuntimeRegistry,
} from "../../../application/ports/session-runtime";
import { PermissionBroker } from "../../../application/services/permission-broker";
import type { IngestEvents } from "../../../application/usecases/ingest-events";
import { BypassLockedError, NotControllableError } from "../../../domain/errors";
import { filterClaudeEnv } from "../../system/login-shell-env";
import { AsyncQueue } from "./async-queue";

// One Claude Code session driven through the Agent SDK in streaming-input mode: the user's
// messages go into a queue the SDK reads, its stream is mapped to events, and tool
// permissions and questions wait in the PermissionBroker for the user's answer in Gravita.
// It runs the user's own `claude` with their own login; nothing here reads credentials.

/** The SDK's `query`, injectable so tests script the stream without a real Claude Code. */
export type QueryFn = (params: {
  prompt: AsyncIterable<SDKUserMessage>;
  options: Options;
}) => Query;

export const sdkQueryFn: QueryFn = (params) => sdkQuery(params);

export interface ClaudeSdkRuntimeDeps {
  ingest: IngestEvents;
  runtimes: SessionRuntimeRegistry;
  status: StatusReporter;
  clock: Clock;
  logger: Logger;
  /** `gravita/<version>`, sent as CLAUDE_AGENT_SDK_CLIENT_APP (the User-Agent suffix). */
  clientApp: string;
  queryFn?: QueryFn;
  /** Logs Claude Code's stderr (first line, truncated). Off by default. */
  debug?: boolean;
  /** How long `dispose` waits for the stream to end. */
  disposeTimeoutMs?: number;
}

/** The environment Claude Code gets: the allowlisted login-shell env plus Gravita's two markers. */
export function chatEnv(env: Record<string, string>, clientApp: string): Record<string, string> {
  return {
    ...filterClaudeEnv(env),
    GRAVITA_MANAGED: "1",
    CLAUDE_AGENT_SDK_CLIENT_APP: clientApp,
  };
}

export class ClaudeSdkRuntime implements ChatRuntime {
  readonly provider = "claude" as const;
  readonly sessionId: string;
  readonly projectId: string;
  private readonly input = new AsyncQueue<SDKUserMessage>();
  private readonly abort = new AbortController();
  private readonly broker: PermissionBroker;
  private readonly mapper: SdkSessionMapper;
  private query: Query | undefined;
  private loop: Promise<void> | undefined;
  private ended = false;
  private disposing = false;

  constructor(
    private readonly spec: ChatRuntimeSpec,
    private readonly d: ClaudeSdkRuntimeDeps,
  ) {
    this.sessionId = spec.sessionId;
    this.projectId = spec.projectId;
    this.broker = new PermissionBroker({
      session: { sessionId: spec.sessionId, projectId: spec.projectId, provider: "claude" },
      ingest: d.ingest,
      clock: d.clock,
      describeInput: inputPreview,
    });
    this.mapper = new SdkSessionMapper({
      projectId: spec.projectId,
      sessionId: spec.sessionId,
      now: () => d.clock.iso(),
    });
  }

  /** The options handed to the SDK's `query`. */
  options(): Options {
    const s = this.spec;
    const canUseTool: CanUseTool = (toolName, input, opts) =>
      this.broker.request({
        toolName,
        input,
        requestId: opts.requestId || opts.toolUseID,
        toolUseId: opts.toolUseID,
        ...(opts.agentID ? { agentId: opts.agentID } : {}),
        signal: opts.signal,
      });
    return {
      pathToClaudeCodeExecutable: s.environment.cliPath,
      cwd: s.cwd,
      sessionId: s.sessionId,
      settingSources: ["user", "project", "local"],
      systemPrompt: { type: "preset", preset: "claude_code" },
      // Explicit: without it Claude Code may pick a settings default or auto mode.
      permissionMode: s.permissionMode,
      // Only when the user started the session in bypass mode (the UI warns first).
      ...(s.permissionMode === "bypassPermissions"
        ? { allowDangerouslySkipPermissions: true }
        : {}),
      forwardSubagentText: true,
      agentProgressSummaries: true,
      env: chatEnv(s.environment.env, this.d.clientApp),
      abortController: this.abort,
      canUseTool,
      ...(s.model && s.model !== "default" ? { model: s.model } : {}),
      stderr: (data: string) => {
        if (!this.d.debug) return;
        const line = data.split("\n")[0]?.slice(0, 200) ?? "";
        this.d.logger.log(`claude stderr [${this.sessionId.slice(0, 8)}] ${line}`);
      },
    };
  }

  start() {
    if (this.query || this.ended || this.disposing) return;
    const query = (this.d.queryFn ?? sdkQueryFn)({ prompt: this.input, options: this.options() });
    this.query = query;
    this.loop = this.run(query);
  }

  async send(text: string, uuid: string) {
    if (this.ended || this.disposing || this.input.isClosed) {
      throw new NotControllableError(this.sessionId);
    }
    this.input.push({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
      uuid: uuid as SDKUserMessage["uuid"],
      session_id: this.sessionId,
    });
  }

  async interrupt() {
    await this.live().interrupt();
  }

  async stopAgent(agentId: string) {
    if (agentId === MAIN_AGENT) return this.interrupt();
    await this.live().stopTask(agentId);
  }

  async setModel(model: string) {
    await this.live().setModel(model === "default" ? undefined : model);
  }

  async setPermissionMode(mode: PermissionMode) {
    if (mode === "bypassPermissions" && this.spec.permissionMode !== "bypassPermissions") {
      throw new BypassLockedError(this.sessionId);
    }
    await this.live().setPermissionMode(mode);
  }

  async respondPermission(agentId: string, requestId: string, decision: PermissionDecision) {
    this.broker.respond(agentId, requestId, decision);
  }

  async answerQuestion(
    agentId: string,
    requestId: string,
    answers: Record<string, string>,
    response?: string,
  ) {
    this.broker.answer(agentId, requestId, answers, response);
  }

  async supportedModels(): Promise<ModelOption[]> {
    const models = await this.live().supportedModels();
    return models.map((m) => ({ value: m.value, displayName: m.displayName }));
  }

  /** Aborts the session and closes Claude Code; resolves once the stream ended (or after a cap). */
  async dispose() {
    if (!this.disposing) {
      this.disposing = true;
      this.broker.dispose();
      this.input.close();
      this.abort.abort();
      try {
        this.query?.close();
      } catch (err) {
        this.d.logger.log("closing claude failed", err);
      }
    }
    if (!this.loop) {
      this.ended = true;
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      this.loop,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, this.d.disposeTimeoutMs ?? 2_000);
      }),
    ]);
    clearTimeout(timer);
  }

  private live(): Query {
    if (!this.query || this.ended || this.disposing) throw new NotControllableError(this.sessionId);
    return this.query;
  }

  private async run(query: Query) {
    try {
      for await (const msg of query) this.handle(msg);
    } catch (err) {
      if (!this.disposing) {
        this.d.logger.log(`claude session ${this.sessionId.slice(0, 8)} stopped`, err);
        this.safely(() =>
          this.d.ingest.execute([
            {
              key: `error:${this.sessionId}:runtime:${this.d.clock.now()}`,
              ts: this.d.clock.iso(),
              source: "gravita",
              provider: "claude",
              projectId: this.projectId,
              sessionId: this.sessionId,
              agentId: MAIN_AGENT,
              type: "error",
              data: {
                kind: "runtime",
                message: "Claude Code stopped unexpectedly",
                retryable: false,
              },
            },
          ]),
        );
      }
    } finally {
      this.ended = true;
      this.input.close();
      this.safely(() => this.broker.dispose());
      // The transcript tailer takes the session over from here (same keys, no duplicates).
      this.safely(() => this.d.runtimes.unregister(this.sessionId));
    }
  }

  private handle(msg: SDKMessage) {
    try {
      const events = this.mapper.map(msg);
      if (events.length) this.d.ingest.execute(events);
    } catch (err) {
      this.d.logger.log("mapping a claude message failed", err);
    }
    if (msg.type === "assistant" && msg.error === "authentication_failed") this.setLoggedIn(false);
    else if (msg.type === "result" && !msg.is_error) this.setLoggedIn(true);
  }

  private setLoggedIn(loggedIn: boolean) {
    const claude = this.d.status.status().claude;
    if (claude.loggedIn !== loggedIn)
      this.d.status.updateStatus({ claude: { ...claude, loggedIn } });
  }

  /** Runs a side effect that may fail once the engine is closing (its database is gone). */
  private safely(fn: () => void) {
    try {
      fn();
    } catch (err) {
      this.d.logger.log("claude session cleanup failed", err);
    }
  }
}

export class ClaudeSdkRuntimeFactory implements ChatRuntimeFactory {
  constructor(private readonly d: ClaudeSdkRuntimeDeps) {}

  create(spec: ChatRuntimeSpec): ClaudeSdkRuntime {
    return new ClaudeSdkRuntime(spec, this.d);
  }
}
