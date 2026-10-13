/** A program to run inside a worktree, without a shell. */
export interface CheckSpec {
  argv: readonly string[];
  /** The worktree (absolute); the check may not leave it. */
  root: string;
  /** Repo-relative working directory; "." for the root. */
  cwd: string;
  timeoutMs?: number;
}

export interface CheckOutcome {
  ok: boolean;
  /** Null when the program was killed, or never started. */
  exitCode: number | null;
  durationMs: number;
  /** The tail of stdout and stderr, interleaved as they arrived. */
  output: string;
  timedOut: boolean;
  /** The program isn't installed (not on PATH). */
  missing: boolean;
}

/** Runs plan checks and package-manager commands. Throws CheckRefusedError for a forbidden spec. */
export interface CheckRunner {
  run(spec: CheckSpec): Promise<CheckOutcome>;
}
