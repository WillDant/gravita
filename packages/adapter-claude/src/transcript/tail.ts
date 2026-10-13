import type { GravitaEvent } from "@gravita/protocol";
import { nodeTranscriptFs, type TranscriptFs } from "./fs";
import type { RawRecord } from "./records";
import { readMeta } from "./subagents";
import { SessionTailState, type TailCheckpoint, type TailStateOptions } from "./tail-state";

export type { TailCheckpoint } from "./tail-state";

export interface SessionTailOptions extends TailStateOptions {
  /** Where the transcript files are read from. Default: the real file system. */
  fs?: TranscriptFs;
}

const READ_CHUNK = 4 * 1024 * 1024;

/**
 * Incremental reader of one session (main transcript + `subagents/`). Each `poll()`
 * reads only appended bytes, keeps partial trailing lines for the next poll, and
 * rescans a file from 0 when it was replaced or truncated (idempotency keys make
 * re-emitted events harmless). Polls are serialized. The decisions live in
 * `SessionTailState`; this class only does the I/O through a `TranscriptFs`.
 */
export class SessionTail {
  readonly sessionId: string;
  readonly mainPath: string;
  private readonly state: SessionTailState;
  private readonly fs: TranscriptFs;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(mainPath: string, opts: SessionTailOptions) {
    this.state = new SessionTailState(mainPath, opts);
    this.fs = opts.fs ?? nodeTranscriptFs;
    this.sessionId = this.state.sessionId;
    this.mainPath = mainPath;
  }

  /** Reads whatever was appended since the last poll and returns the new events. */
  poll(): Promise<GravitaEvent[]> {
    const run = this.queue.then(() => this.step());
    this.queue = run.catch(() => undefined);
    return run;
  }

  checkpoint(): TailCheckpoint {
    return this.state.checkpoint();
  }

  private async step(): Promise<GravitaEvent[]> {
    try {
      this.state.addSubagents(await this.fs.readdir(this.state.subDir));
    } catch {
      // No subagents folder yet.
    }
    // Read every file before assembling, so a parent's Agent call written in the same
    // poll as its child's first line is already indexed.
    const read = new Map<string, RawRecord[]>();
    for (const [agentId, path] of this.state.fileEntries()) {
      const recs = await this.readAppended(agentId, path);
      if (recs.length) read.set(agentId, recs);
    }
    for (const w of this.state.metaWatch()) {
      try {
        const { mtimeMs } = await this.fs.stat(w.metaPath);
        if (mtimeMs === w.mtimeMs) continue;
        const meta = await readMeta(w.metaPath, this.fs);
        if (meta) this.state.setMeta(w.agentId, meta, mtimeMs);
      } catch {
        // Meta not written yet.
      }
    }
    return this.state.assemble(read);
  }

  private async readAppended(agentId: string, path: string): Promise<RawRecord[]> {
    let st: Awaited<ReturnType<TranscriptFs["stat"]>>;
    try {
      st = await this.fs.stat(path);
    } catch {
      return [];
    }
    const records: RawRecord[] = [];
    let pos = this.state.beginRead(agentId, st);
    while (pos < st.size) {
      const chunk = await this.fs.readRange(path, pos, Math.min(READ_CHUNK, st.size - pos));
      if (chunk.byteLength <= 0) break;
      pos += chunk.byteLength;
      this.state.feed(agentId, chunk, records);
    }
    this.state.endRead(agentId, records);
    return records;
  }
}
