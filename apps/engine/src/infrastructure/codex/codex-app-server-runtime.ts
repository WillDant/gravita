import { randomUUID } from "node:crypto";
import {
  CodexAppServerClient,
  type CodexProtocol,
  CodexRpcMapper,
  type CodexSessionMode,
  type CodexSessionPolicy,
  type CodexSquadAccess,
  codexAgentId,
  codexCallId,
  codexSessionId,
  codexSessionPolicy,
  codexSquadPolicy,
  codexToolCall,
  HANDSHAKE_TIMEOUT_MS,
  JsonRpcError,
  type JsonRpcId,
  resolveCodexModel,
  type ServerNotification,
  type ServerRequest,
  strictOutputSchema,
  threadIdOf,
  withoutNulls,
} from "@gravita/adapter-codex";
import { isCodexMode, parseCodexModel } from "@gravita/core";
import { keys, MAIN_AGENT, type SessionMode } from "@gravita/protocol";
import { type GuardedCall, inputPreview, preview } from "@gravita/protocol/tools";
import type {
  ChatRuntime,
  ChatRuntimeFactory,
  ChatRuntimeSpec,
  PermissionVerdict,
  TurnOutcome,
} from "../../application/ports/chat-runtime";
import type { Clock } from "../../application/ports/clock";
import type { StatusReporter } from "../../application/ports/event-publisher";
import type { Logger } from "../../application/ports/logger";
import type { PlanUsageReading } from "../../application/ports/plan-usage-source";
import type {
  ModelOption,
  PermissionDecision,
  SessionRuntimeRegistry,
} from "../../application/ports/session-runtime";
import {
  ASK_USER_QUESTION,
  PermissionBroker,
  type ToolDecision,
} from "../../application/services/permission-broker";
import type { IngestEvents } from "../../application/usecases/ingest-events";
import {
  BypassLockedError,
  InvalidSessionModeError,
  NotControllableError,
  NotLoggedInError,
  SquadProfileError,
} from "../../domain/errors";
import type { LoopbackMcpServer, McpMount } from "../mcp/loopback-mcp-server";
import { type AppServerLauncher, type AppServerProcess, stopAppServer } from "./app-server-process";
import { accountStatusOf, readingOf } from "./codex-account";
import { codexChatEnv } from "./codex-environment";
import { type CodexSquadProfile, codexSquadEnv } from "./codex-squad-profile";
import { CODEX } from "./provider";

// One Codex session driven through `codex app-server`: one app-server per session, one
// thread in it. Messages become turns (or steer the running one), the stream is mapped to
// events with the rollout's keys, and Codex's approvals and questions wait in the
// PermissionBroker for the user's answer in Gravita. Nothing here reads credentials or logs
// anyone in.
//
// A chat runs the user's own `codex` with their own login and CODEX_HOME. A squad session
// (a role, or a Codex-only squad's briefing and planner) runs the same `codex` in Gravita's
// own Codex profile instead (CODEX_HOME=<dataDir>/codex-home: no personal config, MCP
// servers or hooks), sandboxed to its worktree, with Gravita's role tools served to it over
// the engine's loopback MCP route under a token of its own. Every approval it asks for goes
// through the ownership guard and the squad's autonomy policy before the user sees it.

export interface CodexAppServerRuntimeDeps {
  ingest: IngestEvents;
  runtimes: SessionRuntimeRegistry;
  status: StatusReporter;
  clock: Clock;
  logger: Logger;
  launch: AppServerLauncher;
  /** Gravita's version, sent in `clientInfo`. */
  version: string;
  /** Where chats keep their threads when the user's shell doesn't set CODEX_HOME. */
  codexHome?: string;
  /** How long `dispose` waits for the app-server to exit. */
  disposeTimeoutMs?: number;
  /** Squad sessions: Gravita's Codex profile, and where their role tools are served. */
  squad?: { profile: CodexSquadProfile; mcp: LoopbackMcpServer };
}

/** The name Codex knows Gravita's role tools by (they appear as `mcp__gravita__<tool>`). */
export const GRAVITA_MCP_NAME = "gravita";

/** The variable the app-server reads its role-tool token from (kept out of commands). */
export const MCP_TOKEN_ENV = "GRAVITA_MCP_TOKEN";

/**
 * How long one role-tool call may take: complete_task commits and runs the task's checks,
 * which can take minutes (Codex's own default is a minute).
 */
export const ROLE_TOOL_TIMEOUT_SEC = 3_600;

/** A TOML string (the value of a `-c key=value` override). */
const toml = (s: string) => JSON.stringify(s);

/**
 * The app-server's `-c` overrides that add Gravita's role tools for one session: a
 * streamable HTTP MCP server on the engine's loopback port, its token read from the
 * process's environment (never on the command line), required (the session doesn't start
 * without it) and pre-approved (Gravita's own tools are always allowed, as for Claude).
 */
export function roleToolArgs(url: string): string[] {
  const key = (k: string) => `mcp_servers.${GRAVITA_MCP_NAME}.${k}`;
  return [
    ["url", toml(url)],
    ["bearer_token_env_var", toml(MCP_TOKEN_ENV)],
    ["required", "true"],
    ["default_tools_approval_mode", toml("approve")],
    ["startup_timeout_sec", "20"],
    ["tool_timeout_sec", String(ROLE_TOOL_TIMEOUT_SEC)],
  ].flatMap(([k, v]) => ["-c", `${key(k!)}=${v}`]);
}

/** A squad session's access in Codex's terms: its planning access, else the role's autonomy. */
function squadAccess(s: ChatRuntimeSpec): CodexSquadAccess {
  if (s.access) return s.access;
  if (s.autonomy) return s.autonomy;
  return s.permissionMode === "dontAsk" ? "read-only" : "guarded";
}

/**
 * A planning session's answer to an approval (it has no policy of its own): reading is
 * fine, a question goes to the user, anything else is refused (the sandbox is read-only).
 */
function accessVerdict(call: GuardedCall): PermissionVerdict {
  if (call.kind === "read") return "allow";
  if (call.kind === "ask") return "ask";
  return "deny";
}

/** The text of an assistant message among the raw response items. */
function assistantText(item: unknown): string | undefined {
  if (!item || typeof item !== "object") return undefined;
  const m = item as { type?: unknown; role?: unknown; content?: unknown };
  if (m.type !== "message" || m.role !== "assistant" || !Array.isArray(m.content)) return undefined;
  const parts = m.content.flatMap((c) =>
    c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string"
      ? [(c as { text: string }).text]
      : [],
  );
  return parts.length ? parts.join("") : undefined;
}

/** A structured answer: the final message as JSON, its nulls taken out (strict schemas). */
function structuredOf(text: string | undefined): unknown {
  if (!text) return undefined;
  try {
    return withoutNulls(JSON.parse(text));
  } catch {
    return undefined;
  }
}

/** How the user's answer reaches Codex. */
type Approval = "accept" | "decline" | "cancel";

type Thread = CodexProtocol.ThreadStartResponse["thread"];

/** The text input of a turn. */
const textInput = (text: string): CodexProtocol.UserInput[] => [
  { type: "text", text, text_elements: [] },
];

/** The mode a session starts in, in Codex's terms (Gravita's `dontAsk` included). */
function startMode(mode: ChatRuntimeSpec["permissionMode"]): CodexSessionMode {
  if (mode === "dontAsk" || isCodexMode(mode)) return mode;
  throw new InvalidSessionModeError(CODEX, mode);
}

/** A turn's end as the session's next outcome. */
function outcomeOf(turn: CodexProtocol.Turn, structuredOutput?: unknown): TurnOutcome {
  return {
    kind: "result",
    subtype:
      turn.status === "completed"
        ? "success"
        : turn.status === "interrupted"
          ? "interrupted"
          : "error_during_execution",
    isError: turn.status === "failed",
    ...(structuredOutput !== undefined ? { structuredOutput } : {}),
    errors: turn.error?.message ? [turn.error.message] : [],
  };
}

const isUnauthorized = (e: CodexProtocol.TurnError | null | undefined) =>
  e?.codexErrorInfo === "unauthorized";

export class CodexAppServerRuntime implements ChatRuntime {
  readonly provider = CODEX;
  readonly projectId: string;
  readonly kind: ChatRuntime["kind"];
  private threadId: string | undefined;
  private process: AppServerProcess | undefined;
  private client: CodexAppServerClient | undefined;
  private mapper: CodexRpcMapper | undefined;
  private broker: PermissionBroker | undefined;
  private opening: Promise<void> | undefined;
  /** Notifications that arrived before the thread was known. */
  private early: ServerNotification[] = [];
  private activeTurn: string | undefined;
  /** The last turn that ended, so a late turn/start answer doesn't revive it. */
  private lastEnded: string | undefined;
  /** Raw response items are asked for; a Codex that refuses them is read through its items. */
  private rawItems = true;
  /** Sends run one after another, so a turn is started before the next message steers it. */
  private sending: Promise<void> = Promise.resolve();
  private model: string | undefined;
  /** A squad session's reasoning effort (its tier); chats leave Codex's own. */
  private effort: string | undefined;
  /** A squad session's role tools, served on the engine's loopback port while it runs. */
  private mount: McpMount | undefined;
  /** The root thread's last assistant message in the current turn (structured output). */
  private lastText: string | undefined;
  private defaultModel: string | undefined;
  private models: ModelOption[] | undefined;
  /** Settings for the next turn (a model or mode chosen since the last one started). */
  private next: Partial<
    Pick<CodexProtocol.TurnStartParams, "model" | "approvalPolicy" | "sandboxPolicy">
  > = {};
  /** Server requests the server may withdraw (`serverRequest/resolved`). */
  private readonly asks = new Map<string, AbortController>();
  private readonly outcomes: TurnOutcome[] = [];
  private readonly turnWaiters: ((o: TurnOutcome) => void)[] = [];
  private endedAs: TurnOutcome | undefined;
  private ended = false;
  private disposing = false;
  private disposed: Promise<void> | undefined;

  constructor(
    private readonly spec: ChatRuntimeSpec,
    private readonly d: CodexAppServerRuntimeDeps,
  ) {
    this.projectId = spec.projectId;
    this.kind = spec.kind ?? "chat";
    if (this.kind === "squad") {
      if (!d.squad) throw new Error("Codex squad sessions need Gravita's Codex profile");
      // "<model>@<effort>", "default" for the account's default (resolved when it opens).
      const wanted = parseCodexModel(spec.model ?? "");
      this.model = wanted.model;
      this.effort = wanted.effort;
    } else {
      if (spec.roleTools || spec.toolGuard || spec.access)
        throw new Error("Role tools and guards are for squad sessions");
      this.model = spec.model && spec.model !== "default" ? spec.model : undefined;
      startMode(spec.permissionMode);
    }
  }

  private get isSquad(): boolean {
    return this.kind === "squad";
  }

  /** The sandbox and approvals the session starts with (a squad's: by its access). */
  private policy(): CodexSessionPolicy {
    const s = this.spec;
    return this.isSquad
      ? codexSquadPolicy(squadAccess(s), s.cwd)
      : codexSessionPolicy(startMode(s.permissionMode), s.cwd);
  }

  /** Codex names the session: "codex:<thread id>" once `open` resolved. */
  get sessionId(): string {
    return this.threadId ? codexSessionId(this.threadId) : this.spec.sessionId;
  }

  /** Starts the app-server, checks the login and starts (or resumes) the thread. */
  open(): Promise<void> {
    this.opening ??= this.connect();
    return this.opening;
  }

  start() {
    // The stream is read from the moment the app-server runs; nothing more to begin.
    void this.open().catch(() => {});
  }

  async send(text: string, uuid: string) {
    this.alive();
    const run = this.sending.then(() => this.deliverMessage(text, uuid));
    this.sending = run.catch(() => {});
    await run;
  }

  async interrupt() {
    const client = this.live();
    const turnId = this.activeTurn;
    if (!turnId) return;
    try {
      await client.call("turn/interrupt", { threadId: this.threadId!, turnId });
    } catch (err) {
      // The turn ended on its own meanwhile: nothing left to stop.
      if (!(err instanceof JsonRpcError)) throw err;
    }
  }

  async stopAgent(agentId: string) {
    if (agentId === MAIN_AGENT) return this.interrupt();
    // The app-server has no way to stop one subagent: only the whole turn.
    throw new NotControllableError(this.sessionId);
  }

  async setModel(model: string) {
    this.live();
    // "default" is Codex's default model, which only its model list names.
    if (model === "default" && !this.defaultModel) await this.supportedModels().catch(() => {});
    const chosen = model === "default" ? this.defaultModel : model;
    this.model = chosen;
    this.mapper?.setModel(chosen);
    // Codex takes it with the next turn (and keeps it for the ones after).
    if (chosen) this.next.model = chosen;
  }

  async setPermissionMode(mode: SessionMode) {
    if (!isCodexMode(mode)) throw new InvalidSessionModeError(CODEX, mode);
    // A squad session's sandbox follows the squad's autonomy, not a chat's modes.
    if (this.isSquad) throw new NotControllableError(this.sessionId);
    // Like Claude Code's bypass: full access only for a session that started with it.
    if (mode === "fullAccess" && this.spec.permissionMode !== "fullAccess")
      throw new BypassLockedError(this.sessionId);
    this.live();
    const policy = codexSessionPolicy(mode, this.spec.cwd);
    this.next.approvalPolicy = policy.approvalPolicy;
    this.next.sandboxPolicy = policy.sandboxPolicy;
  }

  async respondPermission(agentId: string, requestId: string, decision: PermissionDecision) {
    this.requireBroker().respond(agentId, requestId, decision);
  }

  async answerQuestion(
    agentId: string,
    requestId: string,
    answers: Record<string, string>,
    response?: string,
  ) {
    this.requireBroker().answer(agentId, requestId, answers, response);
  }

  async supportedModels(): Promise<ModelOption[]> {
    if (this.models) return this.models;
    const res = await this.live().call(
      "model/list",
      { includeHidden: false },
      { timeoutMs: HANDSHAKE_TIMEOUT_MS },
    );
    const visible = res.data.filter((m) => !m.hidden);
    this.defaultModel = visible.find((m) => m.isDefault)?.model;
    this.models = visible.map((m) => ({ value: m.model, displayName: m.displayName }));
    return this.models;
  }

  /** The account's plan windows, read through this chat's app-server (no new process). */
  async readPlanUsage(): Promise<PlanUsageReading | undefined> {
    const client = this.client;
    if (!client?.isOpen || this.ended || this.disposing) return undefined;
    const res = await client.call(
      "account/rateLimits/read",
      {},
      { timeoutMs: HANDSHAKE_TIMEOUT_MS },
    );
    return readingOf(res, this.d.clock.now());
  }

  nextTurn(): Promise<TurnOutcome> {
    const next = this.outcomes.shift() ?? this.endedAs;
    if (next) return Promise.resolve(next);
    return new Promise((resolve) => this.turnWaiters.push(resolve));
  }

  /** Answers what is pending, stops the app-server's process group, and ends the session. */
  dispose(): Promise<void> {
    this.disposed ??= (async () => {
      this.disposing = true;
      this.broker?.dispose();
      for (const ask of this.asks.values()) ask.abort();
      this.client?.close();
      if (this.process) await stopAppServer(this.process, this.d.disposeTimeoutMs ?? 2_000);
      this.end("disposed");
    })();
    return this.disposed;
  }

  /** The process's environment and extra arguments: a chat's, or a squad session's. */
  private launchSettings(): { env: Record<string, string>; args: string[] } {
    const s = this.spec;
    const squad = this.isSquad ? this.d.squad : undefined;
    if (!squad) return { env: codexChatEnv(s.environment.env, this.d.codexHome, s.env), args: [] };
    squad.profile.prepare();
    const extra: Record<string, string> = { ...s.env };
    let args: string[] = [];
    if (s.roleTools?.length) {
      const label = [s.squad?.squadId, s.squad?.roleId, s.squad?.taskId].filter(Boolean).join("/");
      this.mount = squad.mcp.mount(s.roleTools, label);
      extra[MCP_TOKEN_ENV] = this.mount.token;
      args = roleToolArgs(this.mount.url);
    }
    return { env: codexSquadEnv(s.environment.env, squad.profile.home, extra), args };
  }

  // Opening.

  private async connect() {
    const s = this.spec;
    const { env, args } = this.launchSettings();
    const proc = this.d.launch({
      cliPath: s.environment.cliPath,
      cwd: s.cwd,
      env,
      ...(args.length ? { args } : {}),
    });
    this.process = proc;
    const client = new CodexAppServerClient(proc.transport, {
      onNotification: (n) => this.notified(n),
      onRequest: (r, id) => this.asked(r, id),
      onProtocolError: (m) => this.d.logger.log(`codex app-server [${this.short()}]: ${m}`),
      onClose: () => this.closed(),
    });
    this.client = client;
    await client.handshake({ name: "gravita", title: "Gravita", version: this.d.version });
    // Gravita never logs in for a chat: the user does, with `codex login`. A squad session
    // runs on Gravita's profile, which the user signed in to once (its own status).
    const account = await client.call("account/read", {}, { timeoutMs: HANDSHAKE_TIMEOUT_MS });
    const status = accountStatusOf(account);
    if (this.isSquad) {
      if (!status.loggedIn)
        throw new SquadProfileError(
          CODEX,
          "Gravita's Codex profile isn't signed in. Sign in to Codex for squads, then resume.",
        );
      await this.resolveModel(client);
    } else {
      this.d.status.updateProvider(CODEX, status);
      if (!status.loggedIn) throw new NotLoggedInError(CODEX);
    }
    const thread = await this.openThread(client);
    this.threadId = thread.id.toLowerCase();
    this.mapper = new CodexRpcMapper({
      projectId: this.projectId,
      sessionId: this.sessionId,
      rootThreadId: this.threadId,
      ...(thread.path ? { rolloutPath: thread.path } : {}),
      ...(this.model ? { model: this.model } : {}),
      rawItems: this.rawItems,
      now: () => this.d.clock.iso(),
    });
    this.broker = new PermissionBroker({
      session: { sessionId: this.sessionId, projectId: this.projectId, provider: CODEX },
      ingest: this.d.ingest,
      clock: this.d.clock,
      describeInput: (input) =>
        typeof input.preview === "string" ? input.preview : inputPreview(input),
    });
    for (const n of this.early.splice(0)) this.notified(n);
  }

  /** A squad tier's model and effort, checked against Codex's catalog. */
  private async resolveModel(client: CodexAppServerClient) {
    const catalog = await client
      .call("model/list", { includeHidden: false }, { timeoutMs: HANDSHAKE_TIMEOUT_MS })
      .then((r) => r.data.filter((m) => !m.hidden))
      .catch(() => []);
    const resolved = resolveCodexModel(
      {
        ...(this.model ? { model: this.model } : {}),
        ...(this.effort ? { effort: this.effort } : {}),
      },
      catalog,
    );
    this.model = resolved.model;
    this.effort = resolved.effort;
  }

  private async openThread(client: CodexAppServerClient): Promise<Thread> {
    const s = this.spec;
    const policy = this.policy();
    const settings = {
      cwd: s.cwd,
      ...(this.model ? { model: this.model } : {}),
      approvalPolicy: policy.approvalPolicy,
      sandbox: policy.sandbox,
      ...(s.systemPromptAppend ? { developerInstructions: s.systemPromptAppend } : {}),
    };
    if (s.resume) {
      const threadId = threadIdOf(s.sessionId);
      if (!threadId) throw new NotControllableError(s.sessionId);
      const res = await client.call("thread/resume", { threadId, ...settings, excludeTurns: true });
      this.model ??= res.model;
      return res.thread;
    }
    try {
      const res = await client.call("thread/start", { ...settings, experimentalRawEvents: true });
      this.model ??= res.model;
      return res.thread;
    } catch (err) {
      if (!(err instanceof JsonRpcError)) throw err;
      this.d.logger.log("codex refused raw events; reading its items instead", err.message);
      this.rawItems = false;
      const res = await client.call("thread/start", settings);
      this.model ??= res.model;
      return res.thread;
    }
  }

  // Messages.

  private async deliverMessage(text: string, uuid: string) {
    await this.open();
    const client = this.live();
    const threadId = this.threadId!;
    const turnId = this.activeTurn;
    if (turnId) {
      try {
        await client.call("turn/steer", {
          threadId,
          input: textInput(text),
          clientUserMessageId: uuid,
          expectedTurnId: turnId,
        });
        return;
      } catch (err) {
        // The turn ended meanwhile (or can't be steered): the message starts the next one.
        if (!(err instanceof JsonRpcError)) throw err;
        this.activeTurn = undefined;
      }
    }
    const next = this.next;
    this.next = {};
    const res = await client.call("turn/start", {
      threadId,
      input: textInput(text),
      clientUserMessageId: uuid,
      ...this.squadTurn(),
      ...next,
    });
    // Its turn/started (and even turn/completed) may have arrived before this answer.
    if (res.turn.status === "inProgress" && this.lastEnded !== res.turn.id)
      this.activeTurn ??= res.turn.id;
  }

  /**
   * What every turn of a squad session restates: its sandbox (the worktree as the one
   * writable root) and approvals, its tier's effort, and the plan's schema for the planner.
   */
  private squadTurn(): Partial<CodexProtocol.TurnStartParams> {
    if (!this.isSquad) return {};
    const policy = this.policy();
    const s = this.spec;
    return {
      approvalPolicy: policy.approvalPolicy,
      sandboxPolicy: policy.sandboxPolicy,
      ...(this.model ? { model: this.model } : {}),
      ...(this.effort ? { effort: this.effort } : {}),
      ...(s.outputSchema
        ? {
            outputSchema: strictOutputSchema(
              s.outputSchema,
            ) as CodexProtocol.TurnStartParams["outputSchema"],
          }
        : {}),
    };
  }

  // The stream.

  private notified(n: ServerNotification) {
    if (!this.mapper) {
      this.early.push(n);
      return;
    }
    try {
      const events = this.mapper.map(n);
      if (events.length) this.d.ingest.execute(events);
    } catch (err) {
      this.d.logger.log("mapping a codex notification failed", err);
    }
    switch (n.method) {
      case "turn/started":
        if (this.isRoot(n.params.threadId)) {
          this.activeTurn = n.params.turn.id;
          this.lastText = undefined;
        }
        return;
      case "item/completed":
        if (this.isRoot(n.params.threadId) && n.params.item.type === "agentMessage")
          this.lastText = n.params.item.text;
        return;
      case "rawResponseItem/completed": {
        const text = this.isRoot(n.params.threadId) ? assistantText(n.params.item) : undefined;
        if (text !== undefined) this.lastText = text;
        return;
      }
      case "turn/completed": {
        if (!this.isRoot(n.params.threadId)) return;
        const { turn } = n.params;
        this.lastEnded = turn.id;
        if (this.activeTurn === turn.id) this.activeTurn = undefined;
        if (isUnauthorized(turn.error)) this.setLoggedIn(false);
        else if (turn.status === "completed") this.setLoggedIn(true);
        const structured =
          this.spec.outputSchema && turn.status === "completed"
            ? structuredOf(this.lastText)
            : undefined;
        // After the mapping, so the turn's events are in the projection when the caller looks.
        this.deliver(outcomeOf(turn, structured));
        return;
      }
      case "mcpServer/startupStatus/updated":
        if (n.params.name === GRAVITA_MCP_NAME && n.params.status === "failed")
          this.d.logger.log(
            `codex session ${this.short()}: Gravita's role tools didn't start (${n.params.error ?? "no reason given"})`,
          );
        return;
      case "error":
        if (isUnauthorized(n.params.error)) this.setLoggedIn(false);
        return;
      case "account/updated": {
        // A squad session's account is Gravita's profile, not the user's Codex.
        if (this.isSquad) return;
        const { authMode, planType } = n.params;
        this.d.status.updateProvider(CODEX, {
          loggedIn: authMode !== null,
          account: {
            ...this.d.status.providerStatus(CODEX)?.account,
            ...(authMode ? { authMode } : {}),
            ...(planType ? { planType } : {}),
          },
        });
        return;
      }
      case "serverRequest/resolved":
        // Codex settled it itself (the turn ended): the card closes.
        this.asks.get(String(n.params.requestId))?.abort();
        return;
    }
  }

  private isRoot(threadId: string): boolean {
    return threadId.toLowerCase() === this.threadId;
  }

  private agentOf(threadId: string): string {
    return this.isRoot(threadId) ? MAIN_AGENT : codexAgentId(threadId);
  }

  // Codex asks.

  private async asked(r: ServerRequest, id: JsonRpcId): Promise<unknown> {
    switch (r.method) {
      case "item/commandExecution/requestApproval": {
        const p = r.params;
        const command = p.command ?? "";
        const toolName = p.kind === "writeStdin" ? "write_stdin" : "exec_command";
        const decision = await this.approve(id, {
          toolName,
          itemId: p.itemId,
          approvalId: p.approvalId ?? undefined,
          threadId: p.threadId,
          preview: preview(command || p.reason || toolName),
          input: {
            command,
            ...(p.cwd ? { cwd: p.cwd } : {}),
            ...(p.reason ? { reason: p.reason } : {}),
          },
          call: codexToolCall(toolName, { cmd: command }, { cwd: p.cwd ?? this.spec.cwd }),
        });
        return { decision } satisfies CodexProtocol.CommandExecutionRequestApprovalResponse;
      }
      case "item/fileChange/requestApproval": {
        const p = r.params;
        const paths = this.mapper?.fileChangePaths(p.itemId) ?? [];
        const decision = await this.approve(id, {
          toolName: "apply_patch",
          itemId: p.itemId,
          threadId: p.threadId,
          preview: preview(paths.join(", ") || p.reason || "file change"),
          input: { paths, ...(p.reason ? { reason: p.reason } : {}) },
          call: { kind: "edit", paths, tool: "apply_patch", cwd: this.spec.cwd },
        });
        return { decision } satisfies CodexProtocol.FileChangeRequestApprovalResponse;
      }
      case "item/permissions/requestApproval": {
        const p = r.params;
        const asked = p.permissions;
        const writes = asked.fileSystem?.write ?? [];
        const decision = await this.approve(id, {
          toolName: "permissions",
          itemId: p.itemId,
          threadId: p.threadId,
          preview: preview(
            p.reason ??
              [asked.network?.enabled ? "network access" : "", ...writes]
                .filter(Boolean)
                .join(", "),
          ),
          input: { reason: p.reason },
          // In a squad, write access is judged like the edits it is for (the guard).
          call: {
            kind: this.isSquad && writes.length ? "edit" : "other",
            paths: writes,
            tool: "permissions",
            cwd: p.cwd,
          },
        });
        // Allowed: what it asked, for this turn only. Otherwise nothing.
        const granted: CodexProtocol.PermissionsRequestApprovalResponse["permissions"] =
          decision === "accept"
            ? {
                ...(asked.network ? { network: asked.network } : {}),
                ...(asked.fileSystem ? { fileSystem: asked.fileSystem } : {}),
              }
            : {};
        return {
          permissions: granted,
          scope: "turn",
        } satisfies CodexProtocol.PermissionsRequestApprovalResponse;
      }
      case "item/tool/requestUserInput":
        return this.question(id, r.params);
      case "mcpServer/elicitation/request":
        // An MCP server's form: not offered in Gravita yet, so it is declined.
        return { action: "decline", content: null, _meta: null };
    }
  }

  private async approve(
    id: JsonRpcId,
    a: {
      toolName: string;
      itemId: string;
      approvalId?: string | undefined;
      threadId: string;
      preview: string;
      input: Record<string, unknown>;
      call: GuardedCall;
    },
  ): Promise<Approval> {
    // A squad role's ownership guard first: what no role may do is declined, and the agent
    // hears why (an approval's answer carries no message, so it comes as a steer).
    const denial = this.spec.toolGuard?.(a.call);
    if (denial) {
      this.d.logger.log(
        `squad guard declined ${a.toolName} in ${this.short()}${a.call.agentId ? ` (subagent ${a.call.agentId})` : ""}: ${denial}`,
      );
      void Promise.resolve().then(() => this.tellAgent(`Gravita declined that: ${denial}`));
      return "decline";
    }
    const verdict =
      this.spec.permissionPolicy?.(a.call) ?? (this.spec.access ? accessVerdict(a.call) : "ask");
    if (verdict === "allow") return "accept";
    if (verdict === "deny") return "decline";
    const ask = new AbortController();
    this.asks.set(String(id), ask);
    try {
      const decision = await this.requireBroker().request({
        toolName: a.toolName,
        input: { ...a.input, preview: a.preview },
        // Unique per request: an item may be asked about more than once.
        requestId: `${codexCallId(a.itemId)}${a.approvalId ? `:${a.approvalId}` : ""}:${String(id)}`,
        toolUseId: codexCallId(a.itemId),
        agentId: this.agentOf(a.threadId),
        signal: ask.signal,
      });
      return this.approvalOf(decision, ask.signal);
    } finally {
      this.asks.delete(String(id));
    }
  }

  /**
   * A word from Gravita to the agent in the middle of its turn (a steer), recorded in the
   * session's conversation like any message Gravita sends. Lost if the turn already ended:
   * the commit gate still stops what it was about.
   */
  private async tellAgent(text: string) {
    const turnId = this.activeTurn;
    const client = this.client;
    if (!turnId || !client?.isOpen || !this.threadId || this.ended || this.disposing) return;
    const uuid = randomUUID();
    try {
      this.d.ingest.execute([
        {
          ts: this.d.clock.iso(),
          source: "gravita",
          provider: CODEX,
          projectId: this.projectId,
          sessionId: this.sessionId,
          agentId: MAIN_AGENT,
          key: keys.userMessage(uuid),
          type: "message.user",
          data: { uuid, textPreview: preview(text), origin: "gravita" },
        },
      ]);
      await client.call("turn/steer", {
        threadId: this.threadId,
        input: textInput(text),
        clientUserMessageId: uuid,
        expectedTurnId: turnId,
      });
    } catch (err) {
      this.d.logger.log(`codex session ${this.short()}: telling the agent failed`, err);
    }
  }

  /** Allow → accept; the user's deny → decline; anything that ended without them → cancel. */
  private approvalOf(d: ToolDecision, signal: AbortSignal): Approval {
    if (d.behavior === "allow") return "accept";
    return this.disposing || this.ended || signal.aborted ? "cancel" : "decline";
  }

  private async question(
    id: JsonRpcId,
    p: CodexProtocol.ToolRequestUserInputParams,
  ): Promise<CodexProtocol.ToolRequestUserInputResponse> {
    const questions = p.questions.map((q) => ({
      question: q.question,
      ...(q.header ? { header: q.header } : {}),
      multiSelect: false,
      options: (q.options ?? []).map((o) => ({
        label: o.label,
        ...(o.description ? { description: o.description } : {}),
      })),
    }));
    const ask = new AbortController();
    this.asks.set(String(id), ask);
    try {
      const decision = await this.requireBroker().request({
        toolName: ASK_USER_QUESTION,
        input: { questions },
        requestId: `${codexCallId(p.itemId)}:${String(id)}`,
        toolUseId: codexCallId(p.itemId),
        agentId: this.agentOf(p.threadId),
        signal: ask.signal,
      });
      if (decision.behavior !== "allow") return { answers: {} };
      const picked = (decision.updatedInput?.answers ?? {}) as Record<string, string>;
      const response =
        typeof decision.updatedInput?.response === "string" ? decision.updatedInput.response : "";
      const answers: CodexProtocol.ToolRequestUserInputResponse["answers"] = {};
      for (const q of p.questions) {
        const answer = picked[q.question] || response;
        if (answer) answers[q.id] = { answers: [answer] };
      }
      return { answers };
    } finally {
      this.asks.delete(String(id));
    }
  }

  // Ending.

  /** The connection closed: a crash unless Gravita closed it. */
  private closed() {
    if (this.disposing || this.ended) return;
    this.d.logger.log(`codex session ${this.short()} stopped`);
    if (this.threadId)
      this.safely(() =>
        this.d.ingest.execute([
          {
            key: `error:${this.sessionId}:runtime:${this.d.clock.now()}`,
            ts: this.d.clock.iso(),
            source: "gravita",
            provider: CODEX,
            projectId: this.projectId,
            sessionId: this.sessionId,
            agentId: MAIN_AGENT,
            type: "error",
            data: { kind: "runtime", message: "Codex stopped unexpectedly", retryable: false },
          },
        ]),
      );
    // Whatever it started must not outlive it.
    this.process?.kill("SIGTERM");
    this.end("crashed");
  }

  private end(reason: "disposed" | "crashed" | "closed") {
    if (this.ended) return;
    this.ended = true;
    // The role tools stop answering with the session.
    this.mount?.close();
    this.safely(() => this.broker?.dispose());
    // The rollout tailer takes the session over from here (same keys, no duplicates).
    this.safely(() => this.d.runtimes.unregister(this.sessionId, this));
    this.endedAs = { kind: "ended", reason };
    for (const waiter of this.turnWaiters.splice(0)) waiter(this.endedAs);
  }

  private deliver(o: TurnOutcome) {
    const waiter = this.turnWaiters.shift();
    if (waiter) waiter(o);
    else this.outcomes.push(o);
  }

  private setLoggedIn(loggedIn: boolean) {
    // A squad session's login is Gravita's profile: the profile re-reads its own.
    if (this.isSquad) {
      if (!loggedIn) void this.d.squad?.profile.status({ force: true }).catch(() => {});
      return;
    }
    if (this.d.status.providerStatus(CODEX)?.loggedIn !== loggedIn)
      this.d.status.updateProvider(CODEX, { loggedIn });
  }

  private alive() {
    if (this.ended || this.disposing) throw new NotControllableError(this.sessionId);
  }

  private live(): CodexAppServerClient {
    this.alive();
    if (!this.client?.isOpen || !this.threadId) throw new NotControllableError(this.sessionId);
    return this.client;
  }

  private requireBroker(): PermissionBroker {
    if (!this.broker) throw new NotControllableError(this.sessionId);
    return this.broker;
  }

  private short() {
    return (this.threadId ?? this.spec.sessionId).slice(0, 8);
  }

  private safely(fn: () => void) {
    try {
      fn();
    } catch (err) {
      this.d.logger.log("codex session cleanup failed", err);
    }
  }
}

export class CodexAppServerRuntimeFactory implements ChatRuntimeFactory {
  constructor(private readonly d: CodexAppServerRuntimeDeps) {}

  create(spec: ChatRuntimeSpec): CodexAppServerRuntime {
    return new CodexAppServerRuntime(spec, this.d);
  }
}
