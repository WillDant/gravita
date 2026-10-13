import { GRAVITA_EMAIL, GRAVITA_NAME } from "../../domain/squad-workspace";

// Runs git for Gravita: argv only (no shell), a scrubbed environment, Gravita's identity and
// safety settings passed per command (the user's git config is never written), a timeout
// and an output cap.

export type Env = Record<string, string | undefined>;

/** Variables that would point git at another repository, index or object store. */
const SCRUBBED = new Set([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
  "GIT_PREFIX",
  // Config injected by a parent git (an alias or hook that started the engine).
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
]);
const SCRUBBED_PREFIXES = ["GIT_CONFIG_KEY_", "GIT_CONFIG_VALUE_"];

// Hooks never run in Gravita's git commands: they are arbitrary code from the repository
// (or the user's global config) and could block or rewrite what Gravita commits. Pointing
// hooksPath at the null device leaves git with no hook to find.
const NO_HOOKS = process.platform === "win32" ? "NUL" : "/dev/null";

/**
 * `-c` settings on every command. They pin what the user's global config could change in
 * ways that break parsing or determinism, without ever writing to that config.
 */
export const GIT_CONFIG_ARGS: readonly string[] = [
  `user.name=${GRAVITA_NAME}`,
  `user.email=${GRAVITA_EMAIL}`,
  "commit.gpgsign=false",
  "tag.gpgsign=false",
  `core.hooksPath=${NO_HOOKS}`,
  // An fsmonitor hook is a program too.
  "core.fsmonitor=false",
  "core.quotePath=false",
  "color.ui=false",
  // Recorded resolutions would silently resolve conflicts Gravita must see.
  "rerere.enabled=false",
  "merge.autoStash=false",
  "gc.auto=0",
  "maintenance.auto=false",
  "advice.detachedHead=false",
].flatMap((kv) => ["-c", kv]);

export interface GitRunOptions {
  cwd: string;
  timeoutMs?: number;
  /** Written to stdin. */
  input?: string;
  /** Overrides the runner's cap for this command. */
  maxOutputBytes?: number;
}

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
  /** stdout went over the cap and was cut. */
  truncated: boolean;
}

export class GitCommandError extends Error {
  constructor(
    readonly argv: readonly string[],
    readonly code: number | null,
    readonly stderr: string,
  ) {
    super(`git ${argv.join(" ")} failed (${code ?? "no exit code"}): ${stderr.trim().slice(-500)}`);
    this.name = "GitCommandError";
  }
}

export interface GitRunnerOptions {
  /** The base environment (default: the engine's). Tests pass an isolated one. */
  env?: Env;
  git?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export const DEFAULT_GIT_TIMEOUT_MS = 30_000;
export const DEFAULT_GIT_MAX_OUTPUT = 8 * 1024 * 1024;

/** The environment git runs with: the base minus redirections, plus non-interactive defaults. */
export function gitEnv(base: Env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined || SCRUBBED.has(k) || SCRUBBED_PREFIXES.some((p) => k.startsWith(p)))
      continue;
    env[k] = v;
  }
  return {
    ...env,
    // Never wait for a password or an editor: there is no terminal behind the engine.
    GIT_TERMINAL_PROMPT: "0",
    GIT_EDITOR: ":",
    GIT_MERGE_AUTOEDIT: "no",
    GIT_PAGER: "cat",
    // Read-only commands (status) don't take the index lock, so they don't race the user.
    GIT_OPTIONAL_LOCKS: "0",
    // Parseable messages whatever the user's locale.
    LC_ALL: "C",
  };
}

/** Reads a stream to text, keeping at most `cap` bytes (the rest is drained and dropped). */
async function readCapped(
  stream: ReadableStream<Uint8Array>,
  cap: number,
): Promise<{ text: string; truncated: boolean }> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for await (const chunk of stream) {
    if (size >= cap) {
      truncated = true;
      continue;
    }
    const room = cap - size;
    const part = chunk.byteLength > room ? chunk.subarray(0, room) : chunk;
    if (part !== chunk) truncated = true;
    chunks.push(part);
    size += part.byteLength;
  }
  return { text: Buffer.concat(chunks).toString("utf8"), truncated };
}

export class GitRunner {
  private readonly env: Record<string, string>;

  constructor(private readonly o: GitRunnerOptions = {}) {
    this.env = gitEnv(o.env ?? process.env);
  }

  /** Runs `git <argv>`; never throws for a non-zero exit (only when git can't start). */
  async run(argv: readonly string[], opts: GitRunOptions): Promise<GitResult> {
    const full = [this.o.git ?? "git", ...GIT_CONFIG_ARGS, ...argv];
    const spawn = () =>
      Bun.spawn(full, {
        cwd: opts.cwd,
        env: this.env,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        timeout: opts.timeoutMs ?? this.o.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS,
        killSignal: "SIGKILL",
      });
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn();
    } catch (err) {
      throw new GitCommandError(argv, null, err instanceof Error ? err.message : String(err));
    }
    if (opts.input !== undefined) proc.stdin.write(opts.input);
    await proc.stdin.end();
    const cap = opts.maxOutputBytes ?? this.o.maxOutputBytes ?? DEFAULT_GIT_MAX_OUTPUT;
    const [out, err] = await Promise.all([
      readCapped(proc.stdout, cap),
      readCapped(proc.stderr, 64 * 1024),
    ]);
    const code = await proc.exited;
    if (proc.signalCode) throw new GitCommandError(argv, null, `killed (${proc.signalCode})`);
    return { code, stdout: out.text, stderr: err.text, truncated: out.truncated };
  }

  /** Runs `git <argv>` and returns stdout; throws GitCommandError on a non-zero exit. */
  async ok(argv: readonly string[], opts: GitRunOptions): Promise<string> {
    const r = await this.run(argv, opts);
    if (r.code !== 0) throw new GitCommandError(argv, r.code, r.stderr);
    return r.stdout;
  }
}
