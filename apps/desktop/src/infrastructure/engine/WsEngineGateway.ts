import type {
  EngineStatus,
  EventsNotification,
  RpcMethod,
  RpcNotification,
  RpcParams,
  RpcResponse,
  RpcResult,
  TerminalOutput,
  TerminalUpdate,
} from "@gravita/protocol";
import { Methods, Notifications, RPC_VERSION } from "@gravita/protocol/constants";
import type {
  EngineGateway,
  EngineSnapshot,
  GatewayConnection,
  Unsubscribe,
} from "./EngineGateway";
import { GatewayError, LocalErrors } from "./GatewayError";
import type { EngineEndpoint } from "./resolveEndpoint";

const CALL_TIMEOUT_MS = 15_000;
const MAX_BACKOFF_MS = 10_000;

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: GatewayError) => void;
}

function listeners<T>() {
  const set = new Set<(value: T) => void>();
  return {
    add(fn: (value: T) => void): Unsubscribe {
      set.add(fn);
      return () => set.delete(fn);
    },
    emit(value: T) {
      for (const fn of set) fn(value);
    },
  };
}

/** JSON-RPC 2.0 over one WebSocket, with auth and automatic reconnect. */
export class WsEngineGateway implements EngineGateway {
  private ws?: WebSocket;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private closed = true;
  private retry = 0;
  /** Bumped on every open and close, so a superseded socket's late close is ignored. */
  private generation = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private endpoint?: Promise<EngineEndpoint>;
  private readonly events = listeners<EventsNotification>();
  private readonly status = listeners<EngineStatus>();
  private readonly connection = listeners<GatewayConnection>();
  private readonly terminalOutput = listeners<TerminalOutput>();
  private readonly terminalUpdate = listeners<TerminalUpdate>();

  /** `endpoint` is resolved once, on first connect (Tauri asks the shell for it). */
  constructor(private readonly resolve: () => Promise<EngineEndpoint>) {}

  connect(): void {
    if (!this.closed) return;
    this.closed = false;
    void this.open();
  }

  close(): void {
    this.closed = true;
    this.generation++;
    clearTimeout(this.retryTimer);
    this.ws?.close();
    this.ws = undefined;
  }

  reconnect(): void {
    this.ws?.close();
  }

  async snapshot(): Promise<EngineSnapshot> {
    const snapshot = (await this.call(Methods.snapshot, {})) as EngineSnapshot;
    // A full snapshot means the link is healthy: the next drop retries quickly again.
    this.retry = 0;
    return snapshot;
  }

  sessionEvents(params: RpcParams<"session.events">): Promise<RpcResult<"session.events">> {
    return this.call(Methods.sessionEvents, params);
  }

  respondPermission(
    params: RpcParams<"permission.respond">,
  ): Promise<RpcResult<"permission.respond">> {
    return this.call(Methods.permissionRespond, params);
  }

  startSession(params: RpcParams<"session.start">): Promise<RpcResult<"session.start">> {
    return this.call(Methods.sessionStart, params);
  }

  sendMessage(params: RpcParams<"session.send">): Promise<RpcResult<"session.send">> {
    return this.call(Methods.sessionSend, params);
  }

  interruptSession(
    params: RpcParams<"session.interrupt">,
  ): Promise<RpcResult<"session.interrupt">> {
    return this.call(Methods.sessionInterrupt, params);
  }

  removeSession(params: RpcParams<"session.remove">): Promise<RpcResult<"session.remove">> {
    return this.call(Methods.sessionRemove, params);
  }

  stopAgent(params: RpcParams<"agent.stop">): Promise<RpcResult<"agent.stop">> {
    return this.call(Methods.agentStop, params);
  }

  setModel(params: RpcParams<"session.setModel">): Promise<RpcResult<"session.setModel">> {
    return this.call(Methods.sessionSetModel, params);
  }

  setPermissionMode(
    params: RpcParams<"session.setPermissionMode">,
  ): Promise<RpcResult<"session.setPermissionMode">> {
    return this.call(Methods.sessionSetPermissionMode, params);
  }

  answerQuestion(params: RpcParams<"question.answer">): Promise<RpcResult<"question.answer">> {
    return this.call(Methods.questionAnswer, params);
  }

  conversation(
    params: RpcParams<"session.conversation">,
  ): Promise<RpcResult<"session.conversation">> {
    return this.call(Methods.sessionConversation, params);
  }

  models(params: RpcParams<"models.list">): Promise<RpcResult<"models.list">> {
    return this.call(Methods.modelsList, params);
  }

  stopAll(): Promise<RpcResult<"engine.stopAll">> {
    return this.call(Methods.stopAll, {});
  }

  createSquad(params: RpcParams<"squad.create">): Promise<RpcResult<"squad.create">> {
    return this.call(Methods.squadCreate, params);
  }

  planSquad(params: RpcParams<"squad.plan">): Promise<RpcResult<"squad.plan">> {
    return this.call(Methods.squadPlan, params);
  }

  replanSquad(params: RpcParams<"squad.replan">): Promise<RpcResult<"squad.replan">> {
    return this.call(Methods.squadReplan, params);
  }

  approvePlan(params: RpcParams<"squad.approvePlan">): Promise<RpcResult<"squad.approvePlan">> {
    return this.call(Methods.squadApprovePlan, params);
  }

  pauseSquad(params: RpcParams<"squad.pause">): Promise<RpcResult<"squad.pause">> {
    return this.call(Methods.squadPause, params);
  }

  resumeSquad(params: RpcParams<"squad.resume">): Promise<RpcResult<"squad.resume">> {
    return this.call(Methods.squadResume, params);
  }

  stopSquad(params: RpcParams<"squad.stop">): Promise<RpcResult<"squad.stop">> {
    return this.call(Methods.squadStop, params);
  }

  retryTask(params: RpcParams<"squad.task.retry">): Promise<RpcResult<"squad.task.retry">> {
    return this.call(Methods.squadTaskRetry, params);
  }

  skipTask(params: RpcParams<"squad.task.skip">): Promise<RpcResult<"squad.task.skip">> {
    return this.call(Methods.squadTaskSkip, params);
  }

  reassignTask(
    params: RpcParams<"squad.task.reassign">,
  ): Promise<RpcResult<"squad.task.reassign">> {
    return this.call(Methods.squadTaskReassign, params);
  }

  deliverSquad(params: RpcParams<"squad.deliver">): Promise<RpcResult<"squad.deliver">> {
    return this.call(Methods.squadDeliver, params);
  }

  refreshUsage(params: RpcParams<"usage.refresh">): Promise<RpcResult<"usage.refresh">> {
    return this.call(Methods.usageRefresh, params);
  }

  codexProfileStatus(): Promise<RpcResult<"codexProfile.status">> {
    return this.call(Methods.codexProfileStatus, {});
  }

  codexProfileSignIn(): Promise<RpcResult<"codexProfile.signIn">> {
    return this.call(Methods.codexProfileSignIn, {});
  }

  codexProfileSignOut(): Promise<RpcResult<"codexProfile.signOut">> {
    return this.call(Methods.codexProfileSignOut, {});
  }

  validateCursorKey(): Promise<RpcResult<"cursorKey.validate">> {
    return this.call(Methods.cursorKeyValidate, {});
  }

  checkForUpdate(): Promise<RpcResult<"update.check">> {
    return this.call(Methods.updateCheck, {});
  }

  installUpdate(): Promise<RpcResult<"update.install">> {
    return this.call(Methods.updateInstall, {});
  }

  spawnTerminal(params: RpcParams<"terminal.spawn">): Promise<RpcResult<"terminal.spawn">> {
    return this.call(Methods.terminalSpawn, params);
  }

  writeTerminal(params: RpcParams<"terminal.write">): Promise<RpcResult<"terminal.write">> {
    return this.call(Methods.terminalWrite, params);
  }

  resizeTerminal(params: RpcParams<"terminal.resize">): Promise<RpcResult<"terminal.resize">> {
    return this.call(Methods.terminalResize, params);
  }

  killTerminal(params: RpcParams<"terminal.kill">): Promise<RpcResult<"terminal.kill">> {
    return this.call(Methods.terminalKill, params);
  }

  listTerminals(): Promise<RpcResult<"terminal.list">> {
    return this.call(Methods.terminalList, {});
  }

  attachTerminal(params: RpcParams<"terminal.attach">): Promise<RpcResult<"terminal.attach">> {
    return this.call(Methods.terminalAttach, params);
  }

  onEvents(listener: (batch: EventsNotification) => void): Unsubscribe {
    return this.events.add(listener);
  }

  onTerminalOutput(listener: (output: TerminalOutput) => void): Unsubscribe {
    return this.terminalOutput.add(listener);
  }

  onTerminalUpdate(listener: (update: TerminalUpdate) => void): Unsubscribe {
    return this.terminalUpdate.add(listener);
  }

  onStatus(listener: (status: EngineStatus) => void): Unsubscribe {
    return this.status.add(listener);
  }

  onConnection(listener: (connection: GatewayConnection) => void): Unsubscribe {
    return this.connection.add(listener);
  }

  private async open() {
    const generation = ++this.generation;
    this.endpoint ??= this.resolve();
    let endpoint: EngineEndpoint;
    try {
      endpoint = await this.endpoint;
    } catch {
      this.endpoint = undefined;
      this.scheduleRetry();
      return;
    }
    if (this.closed || generation !== this.generation) return;
    const ws = new WebSocket(endpoint.url);
    this.ws = ws;
    ws.onopen = async () => {
      try {
        await this.call(Methods.auth, { token: endpoint.token, rpcVersion: RPC_VERSION });
      } catch {
        ws.close();
        return;
      }
      this.connection.emit("online");
      this.call(Methods.status, {}).then(
        (status) => this.status.emit(status),
        () => {},
      );
    };
    ws.onmessage = (msg) => this.receive(msg.data);
    ws.onclose = () => {
      if (generation !== this.generation) return;
      this.ws = undefined;
      for (const p of this.pending.values()) {
        p.reject(new GatewayError(LocalErrors.offline, "closed"));
      }
      this.pending.clear();
      this.connection.emit("offline");
      this.scheduleRetry();
    };
  }

  private scheduleRetry() {
    if (this.closed) return;
    const delay = Math.min(MAX_BACKOFF_MS, 400 * 2 ** this.retry++);
    this.retryTimer = setTimeout(() => void this.open(), delay);
  }

  private receive(raw: unknown) {
    let data: RpcResponse | RpcNotification;
    try {
      data = JSON.parse(String(raw));
    } catch {
      return;
    }
    if ("id" in data && typeof data.id === "number") {
      const p = this.pending.get(data.id);
      if (!p) return;
      this.pending.delete(data.id);
      if (data.error)
        p.reject(new GatewayError(data.error.code, data.error.message, data.error.data));
      else p.resolve(data.result);
      return;
    }
    if ("method" in data) {
      if (data.method === Notifications.events) this.events.emit(data.params as EventsNotification);
      else if (data.method === Notifications.status) this.status.emit(data.params as EngineStatus);
      else if (data.method === Notifications.terminalOutput)
        this.terminalOutput.emit(data.params as TerminalOutput);
      else if (data.method === Notifications.terminalUpdate)
        this.terminalUpdate.emit(data.params as TerminalUpdate);
    }
  }

  /**
   * The one place wire data meets the contract. The engine validates params and results
   * against the same `RpcContract`, so the UI trusts the shape instead of shipping zod.
   */
  private call<M extends RpcMethod>(method: M, params: RpcParams<M>): Promise<RpcResult<M>> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new GatewayError(LocalErrors.offline, "not connected"));
    }
    const id = this.nextId++;
    ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return new Promise<RpcResult<M>>((resolve, reject) => {
      this.pending.set(id, { resolve: (v) => resolve(v as RpcResult<M>), reject });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new GatewayError(LocalErrors.timeout, "timeout"));
      }, CALL_TIMEOUT_MS);
    });
  }
}
