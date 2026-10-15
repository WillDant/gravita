import { nodeRolloutFs, type RolloutFs } from "@gravita/adapter-codex";
import { type GravitaEvent, keys } from "@gravita/protocol";
import { cursorSessionId } from "../ids";
import {
  type FileState,
  MAIN_AGENT,
  type NormalizeContext,
  newFileState,
  normalizeRecord,
} from "./normalize";
import { readNewRecords } from "./read";

// Reads one Cursor chat as it is written: the chat's transcript, and the transcripts of the
// subagents it started (each a transcript of its own). Only ever reads; a poll returns what
// was appended since the last one. Progress is a checkpoint, so a restart goes on from there.

export interface CursorChildFile {
  path: string;
  chatId: string;
  /** The chat that started it (its prompt is in that chat's transcript). */
  parentChatId: string;
}

interface FileProgress {
  ino: number;
  /** Bytes consumed: up to the end of the last complete line. */
  offset: number;
  state: FileState;
  /** A subagent whose start has been reported. */
  spawned?: boolean;
}

export interface CursorTailCheckpoint {
  v: 1;
  started: boolean;
  /** The newest time stamped so far; times never go back. */
  lastTs: number;
  files: Record<string, FileProgress>;
}

export interface CursorSessionTailOptions {
  /** The root chat. */
  chatId: string;
  /** Its transcript. */
  path: string;
  projectId: string;
  cwd: string;
  /** When the chat was created (its `session.started` time) and its title, from its metadata. */
  startedAt: string;
  title?: string;
  fs?: RolloutFs;
  checkpoint?: CursorTailCheckpoint;
  onSkip?: (path: string, reason: string) => void;
}

interface Tracked {
  path: string;
  chatId: string;
  parentChatId?: string;
}

export class CursorSessionTail {
  private readonly fs: RolloutFs;
  private readonly sessionId: string;
  private readonly files: Tracked[];
  private readonly progress = new Map<string, FileProgress>();
  private started: boolean;
  private lastTs: number;
  private polling: Promise<unknown> = Promise.resolve();

  constructor(private readonly o: CursorSessionTailOptions) {
    this.fs = o.fs ?? nodeRolloutFs;
    this.sessionId = cursorSessionId(o.chatId);
    this.files = [{ path: o.path, chatId: o.chatId }];
    this.started = o.checkpoint?.started ?? false;
    this.lastTs = o.checkpoint?.lastTs ?? 0;
    for (const [path, p] of Object.entries(o.checkpoint?.files ?? {})) this.progress.set(path, p);
  }

  /** Subagent transcripts found since: they join the next poll. */
  addChildren(children: readonly CursorChildFile[]) {
    for (const c of children) {
      if (!this.files.some((f) => f.path === c.path)) this.files.push(c);
    }
  }

  /** Whether any of the chat's transcripts is mid-turn. */
  openTurn(): boolean {
    return [...this.progress.values()].some((p) => p.state.turnOpen);
  }

  poll(): Promise<GravitaEvent[]> {
    const run = this.polling.then(() => this.step());
    this.polling = run.catch(() => undefined);
    return run;
  }

  checkpoint(): CursorTailCheckpoint {
    return {
      v: 1,
      started: this.started,
      lastTs: this.lastTs,
      files: Object.fromEntries(this.progress),
    };
  }

  private async step(): Promise<GravitaEvent[]> {
    const events: GravitaEvent[] = [];
    // Parents before the subagents they started, so a subagent finds its task.
    for (const f of this.files) await this.readFile(f, events);
    return events;
  }

  private stamp(mtimeMs: number): string {
    this.lastTs = Math.max(this.lastTs, mtimeMs);
    return new Date(this.lastTs).toISOString();
  }

  private async readFile(f: Tracked, out: GravitaEvent[]) {
    let st: Awaited<ReturnType<RolloutFs["stat"]>>;
    try {
      st = await this.fs.stat(f.path);
    } catch {
      return;
    }
    let p = this.progress.get(f.path);
    // A replaced or shortened file starts over; keys make a second pass harmless.
    if (!p || p.ino !== st.ino || st.size < p.offset) {
      p = {
        ino: st.ino,
        offset: 0,
        state: newFileState(),
        ...(p?.spawned ? { spawned: true } : {}),
      };
      this.progress.set(f.path, p);
    }
    const isRoot = f.chatId === this.o.chatId;
    const ts = this.stamp(st.mtimeMs);
    if (isRoot && !this.started) {
      this.started = true;
      out.push(...this.startEvents());
    }
    const records = await readNewRecords(this.fs, f.path, p, st.size, this.o.onSkip);
    if (records.length === 0) return;
    const ctx: NormalizeContext = {
      sessionId: this.sessionId,
      projectId: this.o.projectId,
      chatId: f.chatId,
      agentId: isRoot ? MAIN_AGENT : cursorSessionId(f.chatId),
    };
    const fresh: GravitaEvent[] = [];
    for (const r of records) fresh.push(...normalizeRecord(ctx, p.state, r, ts));
    if (!isRoot && !p.spawned) {
      out.push(this.spawnEvent(f, p.state, ts));
      p.spawned = true;
    }
    out.push(...fresh);
  }

  private startEvents(): GravitaEvent[] {
    const base = {
      source: "cursor-transcript" as const,
      provider: "cursor" as const,
      projectId: this.o.projectId,
      sessionId: this.sessionId,
    };
    const events: GravitaEvent[] = [
      {
        ...base,
        key: keys.sessionStarted(this.sessionId),
        ts: this.o.startedAt,
        type: "session.started",
        data: { kind: "external", cwd: this.o.cwd },
      },
    ];
    if (this.o.title) {
      events.push({
        ...base,
        key: `session:${this.sessionId}:titled`,
        ts: this.o.startedAt,
        type: "session.titled",
        data: { title: this.o.title },
      });
    }
    return events;
  }

  private spawnEvent(f: Tracked, s: FileState, ts: string): GravitaEvent {
    const parentId = f.parentChatId ?? this.o.chatId;
    const parentIsRoot = parentId === this.o.chatId;
    const parent = this.progress.get(this.pathOf(parentId) ?? "");
    const task = s.firstPrompt !== undefined ? parent?.state.tasks[s.firstPrompt] : undefined;
    const agentId = cursorSessionId(f.chatId);
    return {
      key: keys.agentSpawned(this.sessionId, agentId),
      ts,
      source: "cursor-transcript",
      provider: "cursor",
      projectId: this.o.projectId,
      sessionId: this.sessionId,
      agentId,
      type: "agent.spawned",
      data: {
        parentAgentId: parentIsRoot ? MAIN_AGENT : cursorSessionId(parentId),
        ...(task ? { spawnToolUseId: task.toolUseId } : {}),
        agentType: task?.agentType ?? "subagent",
        ...(task?.description ? { description: task.description } : {}),
        depth: this.depthOf(f),
        background: task?.background ?? false,
      },
    };
  }

  private pathOf(chatId: string): string | undefined {
    return this.files.find((f) => f.chatId === chatId)?.path;
  }

  private depthOf(f: Tracked): number {
    let depth = 0;
    let cur: Tracked | undefined = f;
    while (cur && cur.chatId !== this.o.chatId && depth < 16) {
      depth++;
      const parent: string | undefined = cur.parentChatId;
      cur = this.files.find((x) => x.chatId === parent);
    }
    return depth;
  }
}
