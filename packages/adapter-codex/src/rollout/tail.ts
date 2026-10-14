import type { GravitaEvent } from "@gravita/protocol";
import {
  decompressRollout,
  isCompressed,
  nodeRolloutFs,
  type RolloutFs,
  type RolloutStat,
} from "./fs";
import type { RolloutLine } from "./records";
import {
  type CodexTailCheckpoint,
  CodexTailState,
  type CodexTailStateOptions,
  type ThreadFile,
} from "./tail-state";

export type { CodexTailCheckpoint, ThreadFile } from "./tail-state";

export interface CodexTailOptions extends CodexTailStateOptions {
  /** Where the rollouts are read from. Default: the real file system. */
  fs?: RolloutFs;
  /** Told when a rollout can't be read this time (a compressed one without a codec…). */
  onSkip?: (path: string, reason: string) => void;
}

const READ_CHUNK = 4 * 1024 * 1024;

/**
 * Incremental reader of one Codex session: the root thread's rollout and those of its
 * subagents, which the caller adds as it finds them (`addThreads`). Each `poll()` reads only
 * appended bytes, keeps a partial trailing line for the next poll, and rereads a file from 0
 * when it was replaced or truncated (idempotency keys make re-emitted events harmless).
 * Polls are serialized. The decisions live in `CodexTailState`; this class only does I/O.
 */
export class CodexSessionTail {
  readonly sessionId: string;
  readonly rootPath: string;
  private readonly state: CodexTailState;
  private readonly fs: RolloutFs;
  private readonly onSkip: (path: string, reason: string) => void;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(root: ThreadFile, opts: CodexTailOptions) {
    this.state = new CodexTailState(root, opts);
    this.fs = opts.fs ?? nodeRolloutFs;
    this.onSkip = opts.onSkip ?? (() => {});
    this.sessionId = this.state.sessionId;
    this.rootPath = root.path;
  }

  addThreads(files: readonly ThreadFile[]) {
    this.state.addThreads(files);
  }

  /** True while any thread of the session has a turn in progress. */
  openTurn(): boolean {
    return this.state.openTurn();
  }

  /** Reads whatever was appended since the last poll and returns the new events. */
  poll(): Promise<GravitaEvent[]> {
    const run = this.queue.then(() => this.step());
    this.queue = run.catch(() => undefined);
    return run;
  }

  checkpoint(): CodexTailCheckpoint {
    return this.state.checkpoint();
  }

  private async step(): Promise<GravitaEvent[]> {
    const read = new Map<string, RolloutLine[]>();
    for (const [threadId, path] of this.state.fileEntries()) {
      const lines = await this.readAppended(threadId, path);
      if (lines.length) read.set(threadId, lines);
    }
    return this.state.assemble(read);
  }

  private async readAppended(threadId: string, path: string): Promise<RolloutLine[]> {
    let st: RolloutStat;
    try {
      st = await this.fs.stat(path);
    } catch {
      return [];
    }
    if (isCompressed(path)) return this.readCompressed(threadId, path, st);
    const lines: RolloutLine[] = [];
    let pos = this.state.beginRead(threadId, st);
    while (pos < st.size) {
      const chunk = await this.fs.readRange(path, pos, Math.min(READ_CHUNK, st.size - pos));
      if (chunk.byteLength <= 0) break;
      pos += chunk.byteLength;
      this.state.feed(threadId, chunk, lines);
    }
    this.state.endRead(threadId, lines);
    return lines;
  }

  private async readCompressed(threadId: string, path: string, st: RolloutStat) {
    if (this.state.beginCompressedRead(threadId, st) < 0) return [];
    const data = decompressRollout(await this.fs.readFile(path));
    if (!data) {
      this.onSkip(path, "zstd rollout could not be decompressed");
      return [];
    }
    const lines: RolloutLine[] = [];
    const from = this.state.beginCompressedRead(threadId, st, data.byteLength);
    if (from < data.byteLength) this.state.feed(threadId, data.subarray(from), lines);
    this.state.endRead(threadId, lines);
    return lines;
  }
}
