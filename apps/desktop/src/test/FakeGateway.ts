import type {
  EngineStatus,
  EventsNotification,
  RpcParams,
  RpcResult,
  TerminalInfo,
  TerminalOutput,
  TerminalUpdate,
} from "@gravita/protocol";
import { RpcErrors } from "@gravita/protocol/constants";
import type {
  EngineGateway,
  EngineSnapshot,
  GatewayConnection,
  Unsubscribe,
} from "@/infrastructure/engine/EngineGateway";
import { GatewayError } from "@/infrastructure/engine/GatewayError";

/** The session-driving methods the fake records and can fail on demand. */
export type FakeCommand =
  | "startSession"
  | "sendMessage"
  | "interruptSession"
  | "removeSession"
  | "stopAgent"
  | "setModel"
  | "setPermissionMode"
  | "answerQuestion"
  | "conversation"
  | "models"
  | "stopAll"
  | "createSquad"
  | "planSquad"
  | "replanSquad"
  | "approvePlan"
  | "pauseSquad"
  | "resumeSquad"
  | "stopSquad"
  | "retryTask"
  | "skipTask"
  | "reassignTask"
  | "deliverSquad"
  | "refreshUsage"
  | "codexProfileStatus"
  | "codexProfileSignIn"
  | "codexProfileSignOut"
  | "validateCursorKey"
  | "checkForUpdate"
  | "installUpdate"
  | "spawnTerminal"
  | "writeTerminal"
  | "resizeTerminal"
  | "killTerminal"
  | "listTerminals"
  | "attachTerminal"
  | "gitInfo"
  | "fsList"
  | "fsRead"
  | "fsWrite";

/** In-memory EngineGateway: tests push events and decide what each call returns. */
export class FakeGateway implements EngineGateway {
  connected = false;
  reconnects = 0;
  snapshotResult: EngineSnapshot | Error = {
    seq: 0,
    state: { projects: {}, sessions: {}, squads: {}, usage: {}, seq: 0 },
  };
  sessionEventsResult: RpcResult<"session.events"> | Error = { events: [] };
  readonly responded: RpcParams<"permission.respond">[] = [];
  readonly sessionEventCalls: RpcParams<"session.events">[] = [];
  private pendingSessionEvents: (() => void)[] = [];
  holdSessionEvents = false;

  /** Every session-driving call, in order. */
  readonly calls: { method: FakeCommand; params: unknown }[] = [];
  /** Makes the next calls of a method reject with this error (until cleared). */
  readonly failures: Partial<Record<FakeCommand, GatewayError>> = {};
  startResult: RpcResult<"session.start"> = { sessionId: "new-s", projectId: "p1" };
  conversationResult: RpcResult<"session.conversation"> = { messages: [] };
  modelsResult: RpcResult<"models.list"> = {
    models: [
      { value: "default", displayName: "Default" },
      { value: "opus", displayName: "Opus" },
    ],
  };
  stopAllResult: RpcResult<"engine.stopAll"> = { stopped: 0 };
  createSquadResult: RpcResult<"squad.create"> = { squadId: "sq-new", projectId: "p1" };
  deliverResult: RpcResult<"squad.deliver"> = { ref: "gravita/sq-new/integration" };
  codexProfileResult: RpcResult<"codexProfile.status"> = { loggedIn: false };
  signInResult: RpcResult<"codexProfile.signIn"> = {
    authUrl: "https://auth.openai.com/oauth/authorize?client_id=codex",
  };
  cursorKeyResult: RpcResult<"cursorKey.validate"> = { source: "app", state: "valid" };
  updateCheckResult: RpcResult<"update.check"> = { update: undefined };
  terminalInfo: TerminalInfo = {
    terminalId: "t1",
    command: "shell",
    cwd: "/work/p1",
    projectId: "p1",
    startedAt: "2026-10-12T12:00:00.000Z",
    running: true,
  };
  terminalsResult: RpcResult<"terminal.list"> = { terminals: [] };
  gitInfoResult: RpcResult<"git.info"> = { repo: false };
  /** The project the file explorer sees: relative path → contents. */
  files: Record<string, string> = {};
  /** Each file's mtime; bumped on every write. */
  fileMtimes: Record<string, number> = {};
  scrollback = "";
  /** Methods whose calls wait until `release()`. */
  readonly held = new Set<FakeCommand>();
  private pendingCalls: (() => void)[] = [];

  private readonly listeners = {
    events: new Set<(b: EventsNotification) => void>(),
    status: new Set<(s: EngineStatus) => void>(),
    connection: new Set<(c: GatewayConnection) => void>(),
    terminalOutput: new Set<(o: TerminalOutput) => void>(),
    terminalUpdate: new Set<(u: TerminalUpdate) => void>(),
  };

  connect() {
    this.connected = true;
  }
  close() {
    this.connected = false;
  }
  reconnect() {
    this.reconnects++;
  }

  async snapshot(): Promise<EngineSnapshot> {
    if (this.snapshotResult instanceof Error) throw this.snapshotResult;
    return this.snapshotResult;
  }

  sessionEvents(params: RpcParams<"session.events">): Promise<RpcResult<"session.events">> {
    this.sessionEventCalls.push(params);
    return new Promise((resolve, reject) => {
      const settle = () => {
        const r = this.sessionEventsResult;
        if (r instanceof Error) reject(r);
        else resolve(r);
      };
      if (this.holdSessionEvents) this.pendingSessionEvents.push(settle);
      else settle();
    });
  }

  /** Resolves calls held by `holdSessionEvents`. */
  releaseSessionEvents() {
    for (const settle of this.pendingSessionEvents.splice(0)) settle();
  }

  async respondPermission(
    params: RpcParams<"permission.respond">,
  ): Promise<RpcResult<"permission.respond">> {
    this.responded.push(params);
    return { ok: true };
  }

  private run<T>(method: FakeCommand, params: unknown, value: () => T): Promise<T> {
    this.calls.push({ method, params });
    return new Promise<T>((resolve, reject) => {
      const settle = () => {
        const failure = this.failures[method];
        if (failure) return reject(failure);
        try {
          resolve(value());
        } catch (e) {
          reject(e);
        }
      };
      if (this.held.has(method)) this.pendingCalls.push(settle);
      else settle();
    });
  }

  /** Settles every held call. */
  release() {
    for (const settle of this.pendingCalls.splice(0)) settle();
  }

  callsOf(method: FakeCommand): unknown[] {
    return this.calls.filter((c) => c.method === method).map((c) => c.params);
  }

  startSession(params: RpcParams<"session.start">) {
    return this.run("startSession", params, () => this.startResult);
  }
  sendMessage(params: RpcParams<"session.send">) {
    return this.run("sendMessage", params, () => ({ ok: true }) as const);
  }
  interruptSession(params: RpcParams<"session.interrupt">) {
    return this.run("interruptSession", params, () => ({ ok: true }) as const);
  }
  removeSession(params: RpcParams<"session.remove">) {
    return this.run("removeSession", params, () => ({ ok: true }) as const);
  }
  stopAgent(params: RpcParams<"agent.stop">) {
    return this.run("stopAgent", params, () => ({ ok: true }) as const);
  }
  setModel(params: RpcParams<"session.setModel">) {
    return this.run("setModel", params, () => ({ ok: true }) as const);
  }
  setPermissionMode(params: RpcParams<"session.setPermissionMode">) {
    return this.run("setPermissionMode", params, () => ({ ok: true }) as const);
  }
  answerQuestion(params: RpcParams<"question.answer">) {
    return this.run("answerQuestion", params, () => ({ ok: true }) as const);
  }
  conversation(params: RpcParams<"session.conversation">) {
    return this.run("conversation", params, () => this.conversationResult);
  }
  models(params: RpcParams<"models.list">) {
    return this.run("models", params, () => this.modelsResult);
  }
  stopAll() {
    return this.run("stopAll", {}, () => this.stopAllResult);
  }
  createSquad(params: RpcParams<"squad.create">) {
    return this.run("createSquad", params, () => this.createSquadResult);
  }
  planSquad(params: RpcParams<"squad.plan">) {
    return this.run("planSquad", params, () => ({ ok: true }) as const);
  }
  replanSquad(params: RpcParams<"squad.replan">) {
    return this.run("replanSquad", params, () => ({ ok: true }) as const);
  }
  approvePlan(params: RpcParams<"squad.approvePlan">) {
    return this.run("approvePlan", params, () => ({ ok: true }) as const);
  }
  pauseSquad(params: RpcParams<"squad.pause">) {
    return this.run("pauseSquad", params, () => ({ ok: true }) as const);
  }
  resumeSquad(params: RpcParams<"squad.resume">) {
    return this.run("resumeSquad", params, () => ({ ok: true }) as const);
  }
  stopSquad(params: RpcParams<"squad.stop">) {
    return this.run("stopSquad", params, () => ({ ok: true }) as const);
  }
  retryTask(params: RpcParams<"squad.task.retry">) {
    return this.run("retryTask", params, () => ({ ok: true }) as const);
  }
  skipTask(params: RpcParams<"squad.task.skip">) {
    return this.run("skipTask", params, () => ({ ok: true }) as const);
  }
  reassignTask(params: RpcParams<"squad.task.reassign">) {
    return this.run("reassignTask", params, () => ({ ok: true }) as const);
  }
  deliverSquad(params: RpcParams<"squad.deliver">) {
    return this.run("deliverSquad", params, () => this.deliverResult);
  }
  refreshUsage(params: RpcParams<"usage.refresh">) {
    return this.run("refreshUsage", params, () => ({ ok: true }) as const);
  }
  codexProfileStatus() {
    return this.run("codexProfileStatus", {}, () => this.codexProfileResult);
  }
  codexProfileSignIn() {
    return this.run("codexProfileSignIn", {}, () => this.signInResult);
  }
  codexProfileSignOut() {
    return this.run("codexProfileSignOut", {}, () => ({ ok: true }) as const);
  }
  validateCursorKey() {
    return this.run("validateCursorKey", {}, () => this.cursorKeyResult);
  }
  checkForUpdate() {
    return this.run("checkForUpdate", {}, () => this.updateCheckResult);
  }
  installUpdate() {
    return this.run("installUpdate", {}, () => ({ ok: true }) as const);
  }

  spawnTerminal(params: RpcParams<"terminal.spawn">) {
    return this.run("spawnTerminal", params, () => ({
      ...this.terminalInfo,
      command: params.command,
    }));
  }
  writeTerminal(params: RpcParams<"terminal.write">) {
    return this.run("writeTerminal", params, () => ({ ok: true }) as const);
  }
  resizeTerminal(params: RpcParams<"terminal.resize">) {
    return this.run("resizeTerminal", params, () => ({ ok: true }) as const);
  }
  killTerminal(params: RpcParams<"terminal.kill">) {
    return this.run("killTerminal", params, () => ({ ok: true }) as const);
  }
  listTerminals() {
    return this.run("listTerminals", {}, () => this.terminalsResult);
  }
  attachTerminal(params: RpcParams<"terminal.attach">) {
    return this.run("attachTerminal", params, () => ({
      terminal: this.terminalInfo,
      scrollback: this.scrollback,
    }));
  }
  gitInfo(params: RpcParams<"git.info">) {
    return this.run("gitInfo", params, () => this.gitInfoResult);
  }
  fsList(params: RpcParams<"fs.list">) {
    return this.run("fsList", params, () => {
      const prefix = params.path ? `${params.path}/` : "";
      const seen = new Map<string, "file" | "dir">();
      for (const path of Object.keys(this.files)) {
        if (!path.startsWith(prefix)) continue;
        const [name, ...rest] = path.slice(prefix.length).split("/");
        if (name) seen.set(name, rest.length > 0 ? "dir" : "file");
      }
      const entries = [...seen].map(([name, kind]) => ({ name, kind }));
      entries.sort((a, b) =>
        a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1,
      );
      return { entries };
    });
  }
  fsRead(params: RpcParams<"fs.read">) {
    return this.run("fsRead", params, () => {
      const text = this.files[params.path];
      if (text === undefined)
        throw new GatewayError(RpcErrors.fileNotFound.code, RpcErrors.fileNotFound.message);
      return { kind: "text" as const, text, mtimeMs: this.fileMtimes[params.path] ?? 1 };
    });
  }
  fsWrite(params: RpcParams<"fs.write">) {
    return this.run("fsWrite", params, () => {
      const mtime = this.fileMtimes[params.path] ?? 1;
      if (params.expectedMtimeMs !== undefined && params.expectedMtimeMs !== mtime)
        throw new GatewayError(RpcErrors.fileConflict.code, RpcErrors.fileConflict.message);
      this.files[params.path] = params.text;
      this.fileMtimes[params.path] = mtime + 1;
      return { mtimeMs: mtime + 1 };
    });
  }

  onTerminalOutput(l: (o: TerminalOutput) => void): Unsubscribe {
    this.listeners.terminalOutput.add(l);
    return () => this.listeners.terminalOutput.delete(l);
  }
  onTerminalUpdate(l: (u: TerminalUpdate) => void): Unsubscribe {
    this.listeners.terminalUpdate.add(l);
    return () => this.listeners.terminalUpdate.delete(l);
  }
  emitTerminalOutput(o: TerminalOutput) {
    for (const l of this.listeners.terminalOutput) l(o);
  }
  emitTerminalUpdate(u: TerminalUpdate) {
    for (const l of this.listeners.terminalUpdate) l(u);
  }

  onEvents(l: (b: EventsNotification) => void): Unsubscribe {
    this.listeners.events.add(l);
    return () => this.listeners.events.delete(l);
  }
  onStatus(l: (s: EngineStatus) => void): Unsubscribe {
    this.listeners.status.add(l);
    return () => this.listeners.status.delete(l);
  }
  onConnection(l: (c: GatewayConnection) => void): Unsubscribe {
    this.listeners.connection.add(l);
    return () => this.listeners.connection.delete(l);
  }

  emitConnection(c: GatewayConnection) {
    for (const l of this.listeners.connection) l(c);
  }
  emitEvents(batch: EventsNotification) {
    for (const l of this.listeners.events) l(batch);
  }
  emitStatus(s: EngineStatus) {
    for (const l of this.listeners.status) l(s);
  }
}

/** Lets pending promise callbacks run. */
export const flush = () => new Promise<void>((r) => setTimeout(r, 0));
