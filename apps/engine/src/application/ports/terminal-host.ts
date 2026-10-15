import type { AgentProvider } from "@gravita/protocol";

/** One process running in a pseudo-terminal. */
export interface PtyProcess {
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  /** Ends the process and everything it started (hang-up, then kill); resolves once it exited. */
  kill(): Promise<void>;
}

export interface PtySpawnOptions {
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
  /** Decoded text, in order; a multi-byte character is never split across calls. */
  onData(text: string): void;
  /** The process's exit code, or null when a signal ended it. */
  onExit(code: number | null): void;
}

/** Starts processes in pseudo-terminals (macOS and Linux). */
export interface TerminalHost {
  readonly supported: boolean;
  spawn(o: PtySpawnOptions): PtyProcess;
}

/** How each provider's CLI takes Gravita's choices in an interactive terminal. */
export interface ProviderTerminalFlags {
  /** A session mode (in the provider's terms) as the CLI's flags. */
  modeArgs(provider: AgentProvider, mode: string, cwd: string): string[];
  /** The CLI's own id for a Gravita session id (Codex: the thread id). */
  resumeArg(provider: AgentProvider, sessionId: string): string;
  /** The Gravita session id a resumed CLI session has. */
  sessionIdOf(provider: AgentProvider, resumeId: string): string;
}
