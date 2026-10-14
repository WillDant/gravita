import type { TerminalCommand, TerminalInfo, TerminalUpdate } from "@gravita/protocol";
import {
  TerminalNotFoundError,
  TerminalUnsupportedError,
  TooManyTerminalsError,
} from "../../domain/errors";
import { MAX_TERMINALS } from "../../domain/terminal-command";
import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/id-generator";
import type { Logger } from "../ports/logger";
import type { PtyProcess, TerminalHost } from "../ports/terminal-host";

// The terminals open in the engine. Output reaches listeners in small batches (one frame's
// worth), and the newest part of it is kept so a client that reconnects, or opens the
// terminal later, sees what was printed. Terminals are the user's: the kill switch leaves
// them alone; they end when the user closes them or the engine stops.

/** Output waits this long for company before it is sent. */
export const OUTPUT_BATCH_MS = 16;
/** The largest piece of output sent at once (well under the transport's frame limit). */
export const OUTPUT_CHUNK_CHARS = 32_000;
/** What is kept of each terminal's output for reattaching. */
export const SCROLLBACK_CHARS = 1_000_000;

export interface TerminalListener {
  output(terminalId: string, data: string): void;
  update(update: TerminalUpdate): void;
}

/** What one terminal is started with; argv and env are built by the use case. */
export interface TerminalSpec {
  command: TerminalCommand;
  cwd: string;
  projectId: string;
  sessionId?: string;
  argv: string[];
  env: Record<string, string>;
  cols: number;
  rows: number;
}

interface Entry {
  info: TerminalInfo;
  pty?: PtyProcess;
  scrollback: string[];
  scrollbackChars: number;
  pending: string;
  cancelFlush?: () => void;
  /** Epoch ms it started, to match sessions that start in it. */
  startedMs: number;
}

/** Trims kept output to its newest `max` chars, from a line start when there is one. */
export function trimScrollback(chunks: string[], total: number, max: number): number {
  let excess = total - max;
  while (excess > 0 && chunks.length > 0) {
    const first = chunks[0] ?? "";
    if (first.length <= excess) {
      chunks.shift();
      excess -= first.length;
      total -= first.length;
      continue;
    }
    // Cut inside the first chunk, then forward to the next line so no escape sequence
    // or character is cut in half.
    const nl = first.indexOf("\n", excess - 1);
    const cut = nl >= 0 ? nl + 1 : excess;
    chunks[0] = first.slice(cut);
    total -= cut;
    excess = 0;
  }
  return total;
}

export class TerminalManager {
  private readonly terminals = new Map<string, Entry>();
  private readonly listeners = new Set<TerminalListener>();

  constructor(
    private readonly d: {
      host: TerminalHost;
      clock: Clock;
      ids: IdGenerator;
      logger: Logger;
      max?: number;
    },
  ) {}

  get supported(): boolean {
    return this.d.host.supported;
  }

  listen(l: TerminalListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  list(): TerminalInfo[] {
    return [...this.terminals.values()].map((e) => e.info);
  }

  /** The running terminals, with when each started (for linking sessions to them). */
  running(): { info: TerminalInfo; startedMs: number }[] {
    return [...this.terminals.values()]
      .filter((e) => e.info.running)
      .map((e) => ({ info: e.info, startedMs: e.startedMs }));
  }

  spawn(spec: TerminalSpec): TerminalInfo {
    if (!this.d.host.supported) throw new TerminalUnsupportedError();
    const limit = this.d.max ?? MAX_TERMINALS;
    if (this.list().filter((t) => t.running).length >= limit)
      throw new TooManyTerminalsError(limit);
    const terminalId = this.d.ids.uuid();
    const entry: Entry = {
      info: {
        terminalId,
        command: spec.command,
        cwd: spec.cwd,
        projectId: spec.projectId,
        ...(spec.sessionId ? { sessionId: spec.sessionId } : {}),
        startedAt: this.d.clock.iso(),
        running: true,
      },
      scrollback: [],
      scrollbackChars: 0,
      pending: "",
      startedMs: this.d.clock.now(),
    };
    this.terminals.set(terminalId, entry);
    try {
      entry.pty = this.d.host.spawn({
        argv: spec.argv,
        cwd: spec.cwd,
        env: spec.env,
        cols: spec.cols,
        rows: spec.rows,
        onData: (text) => this.received(entry, text),
        onExit: (code) => this.exited(entry, code),
      });
    } catch (err) {
      this.terminals.delete(terminalId);
      throw err;
    }
    this.announce(entry);
    return entry.info;
  }

  write(terminalId: string, data: string): void {
    const e = this.get(terminalId);
    if (e.info.running) e.pty?.write(data);
  }

  resize(terminalId: string, cols: number, rows: number): void {
    const e = this.get(terminalId);
    if (e.info.running) e.pty?.resize(cols, rows);
  }

  attach(terminalId: string): { terminal: TerminalInfo; scrollback: string } {
    const e = this.get(terminalId);
    this.flush(e);
    return { terminal: e.info, scrollback: e.scrollback.join("") };
  }

  /** Ends the process if it still runs, and forgets the terminal. */
  async kill(terminalId: string): Promise<void> {
    const e = this.get(terminalId);
    this.terminals.delete(terminalId);
    e.cancelFlush?.();
    if (e.info.running) await e.pty?.kill();
    for (const l of this.listeners) l.update({ closed: terminalId });
  }

  /** Records the session a terminal runs (once; later sessions don't take it over). */
  link(terminalId: string, sessionId: string): void {
    const e = this.terminals.get(terminalId);
    if (!e || e.info.sessionId) return;
    e.info = { ...e.info, sessionId };
    this.announce(e);
  }

  /** Ends every terminal (engine shutdown). */
  async disposeAll(): Promise<void> {
    const all = [...this.terminals.keys()];
    await Promise.all(all.map((id) => this.kill(id).catch(() => {})));
  }

  private get(terminalId: string): Entry {
    const e = this.terminals.get(terminalId);
    if (!e) throw new TerminalNotFoundError(terminalId);
    return e;
  }

  private received(e: Entry, text: string): void {
    e.scrollback.push(text);
    e.scrollbackChars = trimScrollback(
      e.scrollback,
      e.scrollbackChars + text.length,
      SCROLLBACK_CHARS,
    );
    e.pending += text;
    if (e.pending.length >= OUTPUT_CHUNK_CHARS) {
      this.flush(e);
      return;
    }
    e.cancelFlush ??= this.d.clock.setTimer(() => this.flush(e), OUTPUT_BATCH_MS);
  }

  private flush(e: Entry): void {
    e.cancelFlush?.();
    e.cancelFlush = undefined;
    if (!e.pending) return;
    const data = e.pending;
    e.pending = "";
    for (let at = 0; at < data.length; at += OUTPUT_CHUNK_CHARS) {
      const piece = data.slice(at, at + OUTPUT_CHUNK_CHARS);
      for (const l of this.listeners) l.output(e.info.terminalId, piece);
    }
  }

  private exited(e: Entry, code: number | null): void {
    this.flush(e);
    e.info = { ...e.info, running: false, exitCode: code };
    if (this.terminals.has(e.info.terminalId)) this.announce(e);
  }

  private announce(e: Entry): void {
    for (const l of this.listeners) {
      try {
        l.update({ terminal: e.info });
      } catch (err) {
        this.d.logger.log("terminal listener failed", err);
      }
    }
  }
}
