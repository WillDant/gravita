import { inputPreview, toolKind, toolTarget } from "@gravita/adapter-claude";
import {
  type EventOf,
  type GravitaEvent,
  type GravitaEventType,
  keys,
  MAIN_AGENT,
  type ProjectIdentity,
  type SessionKind,
} from "@gravita/protocol";
import type { Rng } from "./rng";

// A tiny DSL to script sessions on a virtual clock (ms since the scenario started).
// Agents run in parallel, each with its own cursor; events are sorted by time at the end.

/** An event at a virtual time; `ts` is stamped when the scenario plays it. */
export interface Timed {
  at: number;
  event: GravitaEvent;
}

export type DataOf<T extends GravitaEventType> = EventOf<T>["data"];

export type ProjectInfo = ProjectIdentity;

export class SessionScript {
  readonly events: Timed[] = [];
  readonly sessionId: string;
  readonly pid: number;
  private counter = 0;

  constructor(
    readonly rng: Rng,
    readonly project: ProjectInfo,
  ) {
    this.sessionId = rng.uuid();
    this.pid = rng.int(20_000, 90_000);
  }

  push<T extends GravitaEventType>(
    at: number,
    type: T,
    key: string,
    data: DataOf<T>,
    agentId?: string,
  ) {
    const event = {
      key,
      ts: "",
      source: "fake",
      provider: "claude",
      projectId: this.project.id,
      sessionId: this.sessionId,
      ...(agentId ? { agentId } : {}),
      type,
      data,
    } as GravitaEvent;
    this.events.push({ at: Math.round(at), event });
  }

  /** Unique suffix for keys of events that have no natural id. */
  n(): number {
    return ++this.counter;
  }

  /** ±15% jitter so different seeds don't move in lockstep. */
  jit(ms: number): number {
    return ms * (0.85 + this.rng.next() * 0.3);
  }

  start(
    at: number,
    kind: SessionKind,
    opts: {
      title: string;
      branch: string;
      entrypoint: string;
      /** A squad role's session: which squad, role and task it works for. */
      squad?: { squadId: string; roleId: string; taskId?: string };
    },
  ) {
    this.push(at, "session.started", keys.sessionStarted(this.sessionId), {
      kind,
      cwd: this.project.root,
      gitBranch: opts.branch,
      model: "claude-opus-5-5",
      permissionMode: "default",
      entrypoint: opts.entrypoint,
      cliVersion: "2.1.296",
      ...opts.squad,
    });
    this.push(at, "session.titled", `session:${this.sessionId}:title:${this.n()}`, {
      title: opts.title,
    });
  }

  presence(at: number, status: "busy" | "idle" | "waiting") {
    this.push(at, "session.presence", `presence:${this.sessionId}:${this.n()}`, {
      pid: this.pid,
      status,
    });
  }

  userPrompt(at: number, text: string, origin: "human" | "gravita" = "human"): string {
    const uuid = this.rng.uuid();
    this.push(
      at,
      "message.user",
      keys.userMessage(uuid),
      { uuid, textPreview: text, origin },
      MAIN_AGENT,
    );
    return uuid;
  }

  main(at: number): Actor {
    return new Actor(this, MAIN_AGENT, at, "claude-opus-5-5", 0, false);
  }

  /** Events sorted by time, stable for equal times. */
  sorted(): Timed[] {
    return this.events
      .map((t, i) => ({ t, i }))
      .sort((a, b) => a.t.at - b.t.at || a.i - b.i)
      .map(({ t }) => t);
  }
}

export interface ToolOptions {
  ms: number;
  /** Model time before the call (default ~1.4s). */
  gap?: number;
  output?: string;
  changes?: { path: string; added: number; removed: number }[];
  /** Ask the user first; resolves (allow) after `waitMs`. */
  permission?: { waitMs: number };
  /** The call fails with this error instead of succeeding. */
  error?: string;
}

export class Actor {
  toolCount = 0;
  tokens = 0;
  private context = 12_000;
  private readonly startedAt: number;
  private spawnToolUseId?: string;
  private parent?: Actor;

  constructor(
    readonly s: SessionScript,
    readonly agentId: string,
    public t: number,
    readonly model: string,
    readonly depth: number,
    readonly background: boolean,
  ) {
    this.startedAt = t;
  }

  wait(ms: number): this {
    this.t += this.s.jit(ms);
    return this;
  }

  private messageId(): string {
    return `msg_${this.s.rng.base62(24)}`;
  }

  private usage(messageId: string, output: number) {
    const cacheWrite = this.s.rng.int(0, 3) === 0 ? this.s.rng.int(800, 2400) : 0;
    this.context += output + this.s.rng.int(400, 2600);
    this.tokens += output + cacheWrite;
    this.s.push(
      this.t,
      "usage.reported",
      `${keys.usage(messageId)}:${output}`,
      {
        messageId,
        model: this.model,
        input: this.s.rng.int(3, 12),
        output,
        cacheRead: this.context,
        cacheWrite,
      },
      this.agentId,
    );
  }

  think(ms = 900): this {
    const messageId = this.messageId();
    this.s.push(
      this.t,
      "thinking",
      keys.assistantBlock(messageId, "thinking", String(this.s.n())),
      { messageId },
      this.agentId,
    );
    return this.wait(ms);
  }

  say(text: string, ms = 1200): this {
    const messageId = this.messageId();
    this.s.push(
      this.t,
      "message.assistant",
      keys.assistantBlock(messageId, "text", String(this.s.n())),
      { messageId, textPreview: text, model: this.model },
      this.agentId,
    );
    this.usage(messageId, this.s.rng.int(60, 420));
    return this.wait(ms);
  }

  private startTool(name: string, input: Record<string, unknown>): string {
    const toolUseId = `toolu_${this.s.rng.base62(24)}`;
    const messageId = this.messageId();
    this.s.push(
      this.t,
      "tool.started",
      keys.toolStarted(toolUseId),
      {
        toolUseId,
        name,
        kind: toolKind(name),
        target: toolTarget(input),
        inputPreview: inputPreview(input),
      },
      this.agentId,
    );
    this.usage(messageId, this.s.rng.int(40, 220));
    this.toolCount++;
    return toolUseId;
  }

  private endTool(
    toolUseId: string,
    opts: { output?: string; changes?: ToolOptions["changes"]; error?: string },
  ) {
    this.s.push(
      this.t,
      "tool.completed",
      keys.toolCompleted(toolUseId),
      {
        toolUseId,
        ok: opts.error === undefined,
        ...(opts.output ? { outputPreview: opts.output } : {}),
        ...(opts.error ? { error: opts.error } : {}),
        ...(opts.changes?.length ? { fileChanges: opts.changes } : {}),
      },
      this.agentId,
    );
  }

  tool(name: string, input: Record<string, unknown>, opts: ToolOptions): this {
    this.wait(opts.gap ?? 1400);
    const id = this.startTool(name, input);
    if (opts.permission) {
      const requestId = `perm_${this.s.rng.hex(12)}`;
      this.wait(250);
      this.s.push(
        this.t,
        "permission.requested",
        keys.permissionRequested(requestId),
        { requestId, toolUseId: id, toolName: name, inputPreview: inputPreview(input) },
        this.agentId,
      );
      this.s.presence(this.t, "waiting");
      this.t += opts.permission.waitMs;
      this.s.push(
        this.t,
        "permission.resolved",
        keys.permissionResolved(requestId),
        { requestId, decision: "allow", by: "user" },
        this.agentId,
      );
      this.s.presence(this.t, "busy");
    }
    this.wait(opts.ms);
    this.endTool(id, opts);
    return this.wait(350);
  }

  todo(items: { content: string; status: string }[]): this {
    const input = { todos: items };
    const id = this.startTool("TodoWrite", input);
    this.s.push(this.t, "todo.updated", `todo:${id}`, { items }, this.agentId);
    this.wait(200);
    this.endTool(id, { output: "Todos have been modified successfully" });
    return this.wait(300);
  }

  progress(summary: string): this {
    this.s.push(
      this.t,
      "agent.progress",
      `progress:${this.s.sessionId}:${this.agentId}:${this.s.n()}`,
      { summary, totalTokens: this.tokens, toolUses: this.toolCount },
      this.agentId,
    );
    return this;
  }

  /** Calls the Agent tool and returns the child, already running on its own clock. */
  spawn(
    agentType: string,
    description: string,
    prompt: string,
    opts: { background: boolean; model: string },
  ): Actor {
    const input = {
      description,
      subagent_type: agentType,
      prompt,
      ...(opts.background ? { run_in_background: true } : {}),
    };
    const toolUseId = this.startTool("Agent", input);
    const agentId = `a${this.s.rng.hex(16)}`;
    const child = new Actor(
      this.s,
      agentId,
      this.t + 400,
      opts.model,
      this.depth + 1,
      opts.background,
    );
    child.spawnToolUseId = toolUseId;
    child.parent = this;
    this.s.push(
      this.t + 150,
      "agent.spawned",
      keys.agentSpawned(this.s.sessionId, agentId),
      {
        parentAgentId: this.agentId,
        spawnToolUseId: toolUseId,
        agentType,
        description,
        depth: this.depth + 1,
        background: opts.background,
        model: opts.model,
      },
      agentId,
    );
    if (opts.background) {
      this.s.push(
        this.t + 200,
        "agent.lifecycle",
        keys.agentLifecycle(this.s.sessionId, agentId, "running"),
        { status: "running" },
        agentId,
      );
      this.wait(300);
      this.endTool(toolUseId, { output: `Async agent launched successfully. agentId: ${agentId}` });
      this.wait(300);
    }
    return child;
  }

  /** Ends a subagent. Foreground: the parent's Agent call returns. Background: a task notification. */
  finish(summary: string): this {
    return this.end(summary, "completed");
  }

  /** Ends a subagent with an error; a foreground parent's Agent call returns it as a failure. */
  fail(error: string): this {
    return this.end(error, "failed");
  }

  private end(summary: string, status: "completed" | "failed"): this {
    const parent = this.parent;
    if (!parent || !this.spawnToolUseId) return this;
    const sid = this.s.sessionId;
    const done = {
      status,
      summary,
      totalTokens: this.tokens,
      toolUseCount: this.toolCount,
      durationMs: Math.round(this.t - this.startedAt),
    };
    if (this.background) {
      this.s.push(
        this.t,
        "agent.completed",
        keys.agentCompleted(sid, this.agentId),
        done,
        this.agentId,
      );
      const uuid = this.s.rng.uuid();
      this.s.push(
        this.t + 120,
        "message.user",
        keys.userMessage(uuid),
        { uuid, textPreview: `<task-notification> ${summary}`, origin: "task-notification" },
        MAIN_AGENT,
      );
    } else {
      parent.t = Math.max(parent.t, this.t);
      parent.endTool(
        this.spawnToolUseId,
        status === "failed" ? { error: summary } : { output: summary },
      );
      this.s.push(
        this.t,
        "agent.completed",
        keys.agentCompleted(sid, this.agentId),
        done,
        this.agentId,
      );
      parent.wait(400);
    }
    return this;
  }

  endTurn(turnStartedAt: number, costUsd: number) {
    const uuid = this.s.rng.uuid();
    this.s.push(this.t, "turn.completed", keys.turnCompleted(this.s.sessionId, uuid), {
      subtype: "success",
      costUsd,
      durationMs: Math.round(this.t - turnStartedAt),
      numTurns: this.toolCount + 1,
    });
    this.s.presence(this.t, "idle");
  }
}
