import { JsonRpcClosedError, JsonRpcError, type JsonRpcId, RpcCodes } from "@gravita/adapter-codex";
import {
  type AcpProtocol,
  CursorAcpClient,
  CursorAcpMapper,
  cursorCallId,
  cursorInputPreview,
  cursorSessionId,
  cursorToolCall,
  cursorToolName,
  HANDSHAKE_TIMEOUT_MS,
  maskSecret,
  type ServerNotification,
  type ServerRequest,
} from "@gravita/adapter-cursor";
import { isCursorMode } from "@gravita/core";
import {
  type ConversationMessage,
  type GravitaEvent,
  MAIN_AGENT,
  type SessionMode,
} from "@gravita/protocol";
import { preview } from "@gravita/protocol/tools";
import type {
  ChatRuntime,
  ChatRuntimeFactory,
  ChatRuntimeSpec,
  TurnOutcome,
} from "../../application/ports/chat-runtime";
import type { Clock } from "../../application/ports/clock";
import type { CredentialSource } from "../../application/ports/credential-source";
import type { StatusReporter } from "../../application/ports/event-publisher";
import type { Logger } from "../../application/ports/logger";
import type {
  ModelOption,
  PermissionDecision,
  SessionRuntimeRegistry,
} from "../../application/ports/session-runtime";
import type { CursorKeyStatus } from "../../application/services/cursor-key-status";
import { PermissionBroker } from "../../application/services/permission-broker";
import type { IngestEvents } from "../../application/usecases/ingest-events";
import {
  InvalidSessionModeError,
  NotControllableError,
  NotLoggedInError,
} from "../../domain/errors";
import {
  type AppServerLauncher,
  type AppServerProcess,
  stopAppServer,
} from "../codex/app-server-process";
import { cursorChatEnv } from "./cursor-environment";
import { CURSOR } from "./provider";

// One Cursor chat driven through `cursor-agent acp` (ADR 008): one process per session, one
// ACP session in it. A message is one `session/prompt`, which lasts its whole turn; the next
// message waits for it (ACP can't steer a running turn). The stream is mapped to events,
// and every approval Cursor asks for waits in the PermissionBroker for the user's answer in
// Gravita: once, never "always".
//
// The process runs with the key the user pasted in Gravita, in an environment built from
// scratch (`cursorChatEnv`): nothing of the user's own Cursor login is read or written, and
// Gravita never logs anyone in (`authenticate` is never called). Without a key, nothing is
// started. The key is masked out of everything that becomes an event.

export interface CursorAcpRuntimeDeps {
  ingest: IngestEvents;
  runtimes: SessionRuntimeRegistry;
  status: StatusReporter;
  clock: Clock;
  logger: Logger;
  launch: AppServerLauncher;
  /** Gravita's version, sent in `clientInfo`. */
  version: string;
  credentials: CredentialSource;
  keys: CursorKeyStatus;
  /** How long `dispose` waits for the process to exit. */
  disposeTimeoutMs?: number;
}

/** How long `session/new` may take (it signs in with the key and loads the account). */
export const SESSION_NEW_TIMEOUT_MS = 60_000;

/** ACP's model id of Cursor's Auto. */
const AUTO_MODEL = "default[]";

/** Gravita's name of a Cursor model: "default" for Auto, else Cursor's id. */
const modelValue = (modelId: string) => (modelId === AUTO_MODEL ? "default" : modelId);

/** A turn's stop reason as the session's next outcome. */
function outcomeOf(stopReason: string | undefined, error?: string): TurnOutcome {
  return {
    kind: "result",
    subtype: error
      ? "error_during_execution"
      : stopReason === "end_turn"
        ? "success"
        : stopReason === "cancelled"
          ? "interrupted"
          : (stopReason ?? "success"),
    isError: !!error,
    errors: error ? [error] : [],
  };
}

/** The answer to a permission request: the option of the kind chosen, never an "always". */
function permissionOutcome(
  options: readonly AcpProtocol.PermissionOption[],
  kind: "allow_once" | "reject_once" | "cancelled",
): AcpProtocol.RequestPermissionResponse {
  const option = kind === "cancelled" ? undefined : options.find((o) => o.kind === kind);
  return option
    ? { outcome: { outcome: "selected", optionId: option.optionId } }
    : { outcome: { outcome: "cancelled" } };
}

export class CursorAcpRuntime implements ChatRuntime {
  readonly provider = CURSOR;
  readonly projectId: string;
  readonly kind = "chat" as const;
  private acpSessionId: string | undefined;
  private key: string | undefined;
  private process: AppServerProcess | undefined;
  private client: CursorAcpClient | undefined;
  private mapper: CursorAcpMapper | undefined;
  private broker: PermissionBroker | undefined;
  private opening: Promise<void> | undefined;
  /** Updates that arrived before the session was known. */
  private early: AcpProtocol.SessionNotification[] = [];
  /** Prompts run one after another: a message sent during a turn waits for it. */
  private sending: Promise<void> = Promise.resolve();
  private inTurn = false;
  private mode: string;
  private models: AcpProtocol.ModelInfo[] = [];
  /** Permission requests still waiting for the user, aborted when the turn is cancelled. */
  private readonly asks = new Map<string, AbortController>();
  private readonly outcomes: TurnOutcome[] = [];
  private readonly turnWaiters: ((o: TurnOutcome) => void)[] = [];
  private readonly conversationLog: ConversationMessage[] = [];
  private endedAs: TurnOutcome | undefined;
  private ended = false;
  private disposing = false;
  private disposed: Promise<void> | undefined;

  constructor(
    private readonly spec: ChatRuntimeSpec,
    private readonly d: CursorAcpRuntimeDeps,
  ) {
    this.projectId = spec.projectId;
    // Cursor runs chats only: no squads, so no role tools, guards or planning access.
    if ((spec.kind && spec.kind !== "chat") || spec.roleTools || spec.toolGuard || spec.access)
      throw new Error("Cursor runs chats only");
    if (spec.resume) throw new NotControllableError(spec.sessionId);
    if (!isCursorMode(spec.permissionMode))
      throw new InvalidSessionModeError(CURSOR, spec.permissionMode);
    this.mode = spec.permissionMode;
  }

  /** Cursor names the session: "cursor:<ACP session id>" once `open` resolved. */
  get sessionId(): string {
    return this.acpSessionId ? cursorSessionId(this.acpSessionId) : this.spec.sessionId;
  }

  /** Starts `cursor-agent acp` with the key and opens the ACP session. */
  open(): Promise<void> {
    this.opening ??= this.connect();
    return this.opening;
  }

  start() {
    void this.open().catch(() => {});
  }

  /**
   * Queues the message as the next prompt and returns: the prompt itself lasts the whole
   * turn, and its end is recorded from the stream.
   */
  async send(text: string, uuid: string) {
    this.alive();
    await this.open();
    this.live();
    const run = this.sending.then(() => this.prompt(text, uuid));
    this.sending = run.catch((err) =>
      this.d.logger.log(`cursor session ${this.short()}: prompt failed`, err),
    );
  }

  async interrupt() {
    const client = this.live();
    if (!this.inTurn) return;
    // Pending approvals are answered "cancelled", as ACP requires after a cancel.
    for (const ask of this.asks.values()) ask.abort();
    client.notify("session/cancel", { sessionId: this.acpSessionId! });
  }

  async stopAgent(agentId: string) {
    if (agentId === MAIN_AGENT) return this.interrupt();
    // ACP has no subagents of its own to stop: only the whole turn.
    throw new NotControllableError(this.sessionId);
  }

  async setModel(model: string) {
    const client = this.live();
    const modelId = model === "default" ? AUTO_MODEL : model;
    await client.call(
      "session/set_model",
      { sessionId: this.acpSessionId!, modelId },
      { timeoutMs: HANDSHAKE_TIMEOUT_MS },
    );
    this.mapper?.setModel(modelId === AUTO_MODEL ? undefined : modelId);
  }

  async setPermissionMode(mode: SessionMode) {
    if (!isCursorMode(mode)) throw new InvalidSessionModeError(CURSOR, mode);
    const client = this.live();
    await client.call(
      "session/set_mode",
      { sessionId: this.acpSessionId!, modeId: mode },
      { timeoutMs: HANDSHAKE_TIMEOUT_MS },
    );
    this.mode = mode;
    this.mapper?.setMode(mode);
  }

  async respondPermission(agentId: string, requestId: string, decision: PermissionDecision) {
    this.requireBroker().respond(agentId, requestId, decision);
  }

  async answerQuestion(): Promise<void> {
    // Cursor asks no structured questions over ACP: the agent asks in its message.
    throw new NotControllableError(this.sessionId);
  }

  async supportedModels(): Promise<ModelOption[]> {
    if (!this.models.length) return [{ value: "default", displayName: "Auto" }];
    const seen = new Set<string>();
    const out: ModelOption[] = [];
    for (const m of this.models) {
      const value = modelValue(m.modelId);
      if (seen.has(value)) continue;
      seen.add(value);
      out.push({
        value,
        displayName: m.modelId === AUTO_MODEL ? "Auto" : (m.name ?? m.modelId),
      });
    }
    return out.length ? out : [{ value: "default", displayName: "Auto" }];
  }

  conversation(): readonly ConversationMessage[] {
    return this.conversationLog;
  }

  nextTurn(): Promise<TurnOutcome> {
    const next = this.outcomes.shift() ?? this.endedAs;
    if (next) return Promise.resolve(next);
    return new Promise((resolve) => this.turnWaiters.push(resolve));
  }

  /** Answers what is pending, stops the process group, and ends the session. */
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

  // Opening.

  private async connect() {
    const s = this.spec;
    const key = this.d.credentials.cursorKey();
    // No key, no process: the user sets one in Gravita's settings (never a login).
    if (!key) {
      this.d.status.updateProvider(CURSOR, {
        credential: { source: "none", state: "missing" },
        loggedIn: false,
      });
      throw new NotLoggedInError(CURSOR);
    }
    this.key = key;
    const proc = this.d.launch({
      cliPath: s.environment.cliPath,
      cwd: s.cwd,
      env: cursorChatEnv(s.environment.env, key),
    });
    this.process = proc;
    const client = new CursorAcpClient(proc.transport, {
      onNotification: (n) => this.notified(n),
      onRequest: (r, id) => this.asked(r, id),
      onProtocolError: (m) => this.d.logger.log(`cursor-agent [${this.short()}]: ${this.mask(m)}`),
      onClose: () => this.closed(),
    });
    this.client = client;
    await client.initialize({ name: "gravita", title: "Gravita", version: this.d.version });
    const session = await this.newSession(client, key);
    this.acpSessionId = session.sessionId;
    this.models = session.models?.availableModels ?? [];
    let modelId = session.models?.currentModelId;
    const wanted = s.model && s.model !== "default" ? s.model : AUTO_MODEL;
    if (modelId !== undefined && wanted !== modelId) {
      await client.call(
        "session/set_model",
        { sessionId: session.sessionId, modelId: wanted },
        { timeoutMs: HANDSHAKE_TIMEOUT_MS },
      );
      modelId = wanted;
    }
    if (session.modes && session.modes.currentModeId !== this.mode)
      await client.call(
        "session/set_mode",
        { sessionId: session.sessionId, modeId: this.mode },
        { timeoutMs: HANDSHAKE_TIMEOUT_MS },
      );
    this.mapper = new CursorAcpMapper({
      projectId: this.projectId,
      sessionId: this.sessionId,
      acpSessionId: session.sessionId,
      ...(modelId && modelId !== AUTO_MODEL ? { model: modelId } : {}),
      mode: this.mode,
      now: () => this.d.clock.iso(),
      redact: maskSecret(key),
      onUnknown: (what) => this.d.logger.log(`cursor session ${this.short()}: skipped ${what}`),
      onAssistant: (messageId, text) => this.recordAssistant(messageId, text),
    });
    this.broker = new PermissionBroker({
      session: { sessionId: this.sessionId, projectId: this.projectId, provider: CURSOR },
      ingest: this.d.ingest,
      clock: this.d.clock,
      describeInput: (input) => (typeof input.preview === "string" ? input.preview : ""),
    });
    for (const n of this.early.splice(0)) this.ingestSafely(() => this.mapper!.map(n));
  }

  /**
   * `session/new`, which is where Cursor first uses the key: an authentication error means
   * it was refused; its "internal error" may be a refused key or an unreachable Cursor, so
   * the key is checked to tell them apart.
   */
  private async newSession(
    client: CursorAcpClient,
    key: string,
  ): Promise<AcpProtocol.NewSessionResponse> {
    try {
      const session = await client.call(
        "session/new",
        { cwd: this.spec.cwd, mcpServers: [] },
        { timeoutMs: SESSION_NEW_TIMEOUT_MS },
      );
      this.d.keys.observed(key, "valid");
      return session;
    } catch (err) {
      if (!(err instanceof JsonRpcError)) throw err;
      if (err.code === -32000 || /auth/i.test(err.message)) {
        this.d.keys.observed(key, "invalid");
        throw new NotLoggedInError(CURSOR);
      }
      if (err.code === RpcCodes.internalError && (await this.d.keys.check()).state === "invalid")
        throw new NotLoggedInError(CURSOR);
      throw new Error(`Cursor couldn't start the session: ${this.mask(err.message)}`);
    }
  }

  // Prompts.

  private async prompt(text: string, uuid: string) {
    if (this.ended || this.disposing) return;
    const client = this.live();
    const mapper = this.mapper!;
    this.recordUser(uuid, text);
    this.inTurn = true;
    this.ingestSafely(() => mapper.beginTurn(uuid));
    let outcome: TurnOutcome;
    try {
      const res = await client.call("session/prompt", {
        sessionId: this.acpSessionId!,
        prompt: [{ type: "text", text }],
      });
      this.inTurn = false;
      this.ingestSafely(() => mapper.endTurn({ stopReason: res.stopReason }));
      outcome = outcomeOf(res.stopReason);
    } catch (err) {
      // The process died: `closed` records it and ends the session.
      if (err instanceof JsonRpcClosedError || this.ended || this.disposing) return;
      this.inTurn = false;
      const message = this.mask(err instanceof Error ? err.message : String(err));
      this.ingestSafely(() => mapper.endTurn({ error: message }));
      outcome = outcomeOf(undefined, message);
    } finally {
      this.inTurn = false;
    }
    this.deliver(outcome);
  }

  // The stream.

  private notified(n: ServerNotification) {
    if (n.method !== "session/update") return;
    if (this.acpSessionId && n.params.sessionId !== this.acpSessionId) return;
    if (!this.mapper) {
      this.early.push(n.params);
      return;
    }
    this.ingestSafely(() => this.mapper!.map(n.params));
  }

  private ingestSafely(map: () => GravitaEvent[]) {
    try {
      const events = map();
      if (events.length) this.d.ingest.execute(events);
    } catch (err) {
      this.d.logger.log("mapping a cursor update failed", err);
    }
  }

  // Cursor asks.

  private async asked(r: ServerRequest, id: JsonRpcId): Promise<unknown> {
    if (r.method !== "session/request_permission")
      throw new JsonRpcError(RpcCodes.methodNotFound, `${r.method} is not supported by Gravita`);
    const p = r.params;
    const broker = this.broker;
    const mapper = this.mapper;
    if (!broker || !mapper || this.ended || this.disposing)
      return permissionOutcome(p.options, "cancelled");
    const call = mapper.toolCall(p.toolCall.toolCallId, p.toolCall);
    const guarded = cursorToolCall(call, { cwd: this.spec.cwd });
    const verdict = this.spec.permissionPolicy?.(guarded) ?? "ask";
    if (verdict === "allow") return permissionOutcome(p.options, "allow_once");
    if (verdict === "deny") return permissionOutcome(p.options, "reject_once");
    const toolUseId = cursorCallId(this.acpSessionId!, call.toolCallId);
    const ask = new AbortController();
    this.asks.set(String(id), ask);
    try {
      const decision = await broker.request({
        toolName: cursorToolName(call),
        // Only the masked preview: the request's input is shown, never sent back.
        input: { preview: preview(this.mask(cursorInputPreview(call))) },
        requestId: `${toolUseId}:${String(id)}`,
        toolUseId,
        signal: ask.signal,
      });
      if (decision.behavior === "allow") return permissionOutcome(p.options, "allow_once");
      return permissionOutcome(
        p.options,
        this.disposing || this.ended || ask.signal.aborted ? "cancelled" : "reject_once",
      );
    } finally {
      this.asks.delete(String(id));
    }
  }

  // Ending.

  /** The connection closed: a crash unless Gravita closed it. */
  private closed() {
    if (this.disposing || this.ended) return;
    this.d.logger.log(`cursor session ${this.short()} stopped`);
    if (this.acpSessionId) {
      const mapper = this.mapper;
      if (this.inTurn && mapper) {
        this.inTurn = false;
        this.ingestSafely(() => mapper.endTurn({ stopReason: "crashed" }));
      }
      this.ingestSafely(() => [
        {
          key: `error:${this.sessionId}:runtime:${this.d.clock.now()}`,
          ts: this.d.clock.iso(),
          source: "gravita",
          provider: CURSOR,
          projectId: this.projectId,
          sessionId: this.sessionId,
          agentId: MAIN_AGENT,
          type: "error",
          data: { kind: "runtime", message: "Cursor stopped unexpectedly", retryable: false },
        },
      ]);
    }
    // Whatever it started must not outlive it.
    this.process?.kill("SIGTERM");
    this.end("crashed");
  }

  private end(reason: "disposed" | "crashed" | "closed") {
    if (this.ended) return;
    this.ended = true;
    this.safely(() => this.broker?.dispose());
    this.safely(() => this.d.runtimes.unregister(this.sessionId, this));
    this.endedAs = { kind: "ended", reason };
    for (const waiter of this.turnWaiters.splice(0)) waiter(this.endedAs);
  }

  private deliver(o: TurnOutcome) {
    const waiter = this.turnWaiters.shift();
    if (waiter) waiter(o);
    else this.outcomes.push(o);
  }

  private mask(text: string): string {
    return maskSecret(this.key)(text);
  }

  private recordUser(uuid: string, text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.conversationLog.push({
      uuid,
      role: "user",
      ts: this.d.clock.iso(),
      text: this.mask(trimmed),
    });
  }

  private recordAssistant(messageId: string, text: string) {
    if (!text) return;
    this.conversationLog.push({
      uuid: messageId,
      role: "assistant",
      ts: this.d.clock.iso(),
      text,
    });
  }

  private alive() {
    if (this.ended || this.disposing) throw new NotControllableError(this.sessionId);
  }

  private live(): CursorAcpClient {
    this.alive();
    if (!this.client?.isOpen || !this.acpSessionId) throw new NotControllableError(this.sessionId);
    return this.client;
  }

  private requireBroker(): PermissionBroker {
    if (!this.broker) throw new NotControllableError(this.sessionId);
    return this.broker;
  }

  private short() {
    return (this.acpSessionId ?? this.spec.sessionId).slice(0, 8);
  }

  private safely(fn: () => void) {
    try {
      fn();
    } catch (err) {
      this.d.logger.log("cursor session cleanup failed", err);
    }
  }
}

export class CursorAcpRuntimeFactory implements ChatRuntimeFactory {
  constructor(private readonly d: CursorAcpRuntimeDeps) {}

  create(spec: ChatRuntimeSpec): CursorAcpRuntime {
    return new CursorAcpRuntime(spec, this.d);
  }
}
