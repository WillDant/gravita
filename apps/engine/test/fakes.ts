import type {
  ConversationMessage,
  GravitaEvent,
  PermissionMode,
  Provider,
} from "@gravita/protocol";
import type {
  AgentEnvironment,
  AgentEnvironmentSource,
} from "../src/application/ports/agent-environment";
import type {
  ChatRuntime,
  ChatRuntimeFactory,
  ChatRuntimeSpec,
  TurnOutcome,
} from "../src/application/ports/chat-runtime";
import type { CheckpointStore, SavedTail } from "../src/application/ports/checkpoint-store";
import type { Clock } from "../src/application/ports/clock";
import type { EventPublisher } from "../src/application/ports/event-publisher";
import type { EventStore } from "../src/application/ports/event-store";
import type { IdGenerator } from "../src/application/ports/id-generator";
import type { Logger } from "../src/application/ports/logger";
import type {
  ModelOption,
  PermissionDecision,
  SessionRuntime,
  SessionRuntimeRegistry,
} from "../src/application/ports/session-runtime";
import type { TranscriptReader } from "../src/application/ports/transcript-reader";
import type { Workspace } from "../src/application/ports/workspace";

// In-memory fakes of the application ports, for use-case tests without SQLite or sockets.

export class FakeClock implements Clock {
  private timers: { at: number; fn: () => void; cancelled: boolean }[] = [];

  constructor(public t = Date.parse("2026-10-12T10:00:00.000Z")) {}

  now(): number {
    return this.t;
  }

  iso(): string {
    return new Date(this.t).toISOString();
  }

  setTimer(fn: () => void, ms: number): () => void {
    const timer = { at: this.t + ms, fn, cancelled: false };
    this.timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  }

  /** Moves time forward and runs the timers that came due. */
  advance(ms: number) {
    this.t += ms;
    const due = this.timers.filter((x) => !x.cancelled && x.at <= this.t);
    this.timers = this.timers.filter((x) => !due.includes(x));
    for (const x of due) x.fn();
  }

  pendingTimers(): number {
    return this.timers.filter((x) => !x.cancelled).length;
  }
}

export class MemoryEventStore implements EventStore {
  readonly rows: GravitaEvent[] = [];
  /** Labels of what ran inside a transaction, in order. */
  readonly txLog: string[] = [];
  inTx = false;

  insert(e: GravitaEvent): number | null {
    if (this.rows.some((r) => r.key === e.key)) return null;
    this.rows.push(e);
    if (this.inTx) this.txLog.push(`insert:${e.key}`);
    return this.rows.length;
  }

  transaction<T>(fn: () => T): T {
    this.inTx = true;
    try {
      return fn();
    } finally {
      this.inTx = false;
    }
  }

  maxSeq(): number {
    return this.rows.length;
  }

  allEvents(): Iterable<GravitaEvent> {
    return this.rows;
  }

  sessionEvents(sessionId: string): GravitaEvent[] {
    return this.rows.filter((e) => e.sessionId === sessionId);
  }
}

/** A checkpoint store that writes into the event store's transaction log. */
export class MemoryCheckpointStore implements CheckpointStore {
  readonly saved = new Map<string, SavedTail>();

  constructor(private readonly tx: MemoryEventStore) {}

  load(sessionId: string): SavedTail | undefined {
    return this.saved.get(sessionId);
  }

  save(sessionId: string, tail: SavedTail) {
    this.tx.txLog.push(this.tx.inTx ? `checkpoint:${sessionId}` : `checkpoint-outside-tx`);
    this.saved.set(sessionId, tail);
  }
}

export class RecordingPublisher implements EventPublisher {
  readonly batches: { keys: string[]; seq: number }[] = [];

  publish(events: readonly GravitaEvent[], seq: number) {
    this.batches.push({ keys: events.map((e) => e.key), seq });
  }
}

export class SilentLogger implements Logger {
  readonly lines: string[] = [];

  log(message: string) {
    this.lines.push(message);
  }
}

export class FakeRuntime implements SessionRuntime {
  readonly answered: { agentId: string; requestId: string; decision: PermissionDecision }[] = [];
  readonly sent: { text: string; uuid: string }[] = [];
  /** Control calls in order, e.g. "interrupt", "stop:a1", "model:opus", "mode:plan". */
  readonly calls: string[] = [];
  readonly questions: {
    agentId: string;
    requestId: string;
    answers: Record<string, string>;
    response?: string;
  }[] = [];
  disposed = false;
  /** When set, every control call rejects with it. */
  failWith: Error | undefined;
  supportedModels?: () => Promise<ModelOption[]>;

  constructor(
    readonly sessionId: string,
    readonly projectId = "p1",
    readonly provider: Provider = "claude",
  ) {}

  async respondPermission(agentId: string, requestId: string, decision: PermissionDecision) {
    this.check();
    this.answered.push({ agentId, requestId, decision });
  }

  async send(text: string, uuid: string) {
    this.check();
    this.sent.push({ text, uuid });
  }

  async interrupt() {
    this.check();
    this.calls.push("interrupt");
  }

  async stopAgent(agentId: string) {
    this.check();
    this.calls.push(`stop:${agentId}`);
  }

  async setModel(model: string) {
    this.check();
    this.calls.push(`model:${model}`);
  }

  async setPermissionMode(mode: PermissionMode) {
    this.check();
    this.calls.push(`mode:${mode}`);
  }

  async answerQuestion(
    agentId: string,
    requestId: string,
    answers: Record<string, string>,
    response?: string,
  ) {
    this.check();
    this.questions.push({ agentId, requestId, answers, ...(response ? { response } : {}) });
  }

  async dispose() {
    this.disposed = true;
  }

  private check() {
    if (this.failWith) throw this.failWith;
  }
}

/** A chat runtime that records whether it was registered when it started. */
export class FakeChatRuntime extends FakeRuntime implements ChatRuntime {
  started = false;
  registeredAtStart = false;
  /** Set for a runtime whose agent names the session as it opens (like Codex). */
  open?: () => Promise<void>;

  constructor(
    readonly spec: ChatRuntimeSpec,
    private readonly runtimes: SessionRuntimeRegistry,
  ) {
    super(spec.sessionId, spec.projectId, spec.provider);
  }

  private readonly turns: TurnOutcome[] = [];
  private readonly waiters: ((o: TurnOutcome) => void)[] = [];

  start() {
    this.started = true;
    this.registeredAtStart = this.runtimes.get(this.sessionId) === this;
  }

  /** Scripts the outcome of the next turn. */
  pushTurn(o: TurnOutcome) {
    const w = this.waiters.shift();
    if (w) w(o);
    else this.turns.push(o);
  }

  nextTurn(): Promise<TurnOutcome> {
    const next = this.turns.shift();
    if (next) return Promise.resolve(next);
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

export class FakeChatFactory implements ChatRuntimeFactory {
  readonly created: FakeChatRuntime[] = [];
  /** Makes `send` of the next runtime fail (to test the rollback). */
  failSend: Error | undefined;
  /** Runtimes created from now on open (`open()`) when this settles. */
  opening: Promise<void> | undefined;

  constructor(private readonly runtimes: SessionRuntimeRegistry) {}

  create(spec: ChatRuntimeSpec): FakeChatRuntime {
    const r = new FakeChatRuntime(spec, this.runtimes);
    if (this.failSend) r.failWith = this.failSend;
    const opening = this.opening;
    if (opening) r.open = () => opening;
    this.created.push(r);
    return r;
  }
}

export class FakeWorkspace implements Workspace {
  constructor(readonly dirs: Set<string> = new Set(["/work/demo"])) {}

  async isDirectory(path: string): Promise<boolean> {
    return this.dirs.has(path);
  }
}

export class FakeClaudeEnvironment implements AgentEnvironmentSource {
  loads = 0;

  constructor(
    public result: AgentEnvironment | Error = {
      provider: "claude",
      cliPath: "/bin/claude",
      cliVersion: "2.1.296",
      env: { PATH: "/usr/bin", HOME: "/home/u" },
    },
  ) {}

  async load(): Promise<AgentEnvironment> {
    this.loads++;
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

/** Ids "id-1", "id-2", … in order. */
export class SeqIds implements IdGenerator {
  private n = 0;

  uuid(): string {
    this.n++;
    return `id-${this.n}`;
  }
}

export class FakeTranscriptReader implements TranscriptReader {
  constructor(readonly bySession: Record<string, ConversationMessage[]> = {}) {}

  async conversation(sessionId: string): Promise<ConversationMessage[]> {
    return this.bySession[sessionId] ?? [];
  }
}
