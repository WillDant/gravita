import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { CHECK_PROGRAMS } from "@gravita/core";
import type { CheckOutcome, CheckRunner, CheckSpec } from "../../application/ports/check-runner";
import { CheckRefusedError } from "../../domain/errors";
import type { Env } from "../git/git-runner";

// Runs plan checks (and lockfile regeneration) inside a worktree: argv only, never a shell,
// an allowlisted environment, a timeout that kills the whole process tree, and only the tail
// of the output kept.

export const DEFAULT_CHECK_TIMEOUT_MS = 10 * 60_000;
/** How much output a check keeps (its tail). */
export const CHECK_OUTPUT_CAP = 16 * 1024;
/** After SIGTERM on timeout, how long before SIGKILL. */
const KILL_GRACE_MS = 2_000;
/** After the program exits, how long to wait for pipes a straggler still holds. */
const DRAIN_GRACE_MS = 500;

/**
 * Variables a check gets from the engine's environment, by exact name. Toolchains need
 * their homes and caches, the network needs proxies and CA bundles. Secrets (registry and
 * cloud tokens, SSH agents, API keys) are not passed: a check runs code the agents wrote.
 * Package managers still read the user's own config files under HOME (~/.npmrc…).
 */
const CHECK_ENV_EXACT = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "LANG",
  "TZ",
  "TMPDIR",
  "TMP",
  "TEMP",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  // JavaScript toolchains.
  "PNPM_HOME",
  "COREPACK_HOME",
  "BUN_INSTALL",
  "VOLTA_HOME",
  "NVM_DIR",
  "FNM_DIR",
  // Go, Rust, Python, Java.
  "GOPATH",
  "GOROOT",
  "GOCACHE",
  "GOMODCACHE",
  "CARGO_HOME",
  "RUSTUP_HOME",
  "PYENV_ROOT",
  "VIRTUAL_ENV",
  "UV_CACHE_DIR",
  "JAVA_HOME",
  // Windows essentials.
  "SystemRoot",
  "SYSTEMROOT",
  "ComSpec",
  "PATHEXT",
  "WINDIR",
  "APPDATA",
  "LOCALAPPDATA",
  "USERPROFILE",
  "ProgramFiles",
]);

/** What every check runs with on top of the allowlist. */
const CHECK_ENV_FIXED: Record<string, string> = {
  CI: "1",
  NO_COLOR: "1",
  FORCE_COLOR: "0",
  // Husky and friends install git hooks on `install`; never in Gravita's worktrees.
  HUSKY: "0",
  // A pinned packageManager is fetched without a prompt nobody could answer.
  COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
  GIT_TERMINAL_PROMPT: "0",
};

export function checkEnv(base: Env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (v !== undefined && v !== "" && (CHECK_ENV_EXACT.has(k) || k.startsWith("LC_"))) env[k] = v;
  }
  return { ...env, ...CHECK_ENV_FIXED };
}

/** Keeps the last `cap` characters of what is appended. */
class Tail {
  private parts: string[] = [];
  private size = 0;

  constructor(private readonly cap: number) {}

  push(s: string) {
    this.parts.push(s);
    this.size += s.length;
    if (this.size > this.cap * 2) this.compact();
  }

  private compact() {
    const all = this.parts.join("");
    const kept = all.slice(-this.cap);
    this.parts = [kept];
    this.size = kept.length;
  }

  toString(): string {
    return this.parts.join("").slice(-this.cap);
  }
}

async function pump(stream: ReadableStream<Uint8Array>, tail: Tail): Promise<void> {
  const decoder = new TextDecoder();
  for await (const chunk of stream) tail.push(decoder.decode(chunk, { stream: true }));
  tail.push(decoder.decode());
}

const within = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

export interface BunCheckRunnerOptions {
  /** The base environment, filtered through the allowlist (default: the engine's). */
  env?: () => Env | Promise<Env>;
  timeoutMs?: number;
  killGraceMs?: number;
}

export class BunCheckRunner implements CheckRunner {
  constructor(private readonly o: BunCheckRunnerOptions = {}) {}

  /** The folder a check runs in; refuses anything outside the worktree (symlinks included). */
  private async workdir(root: string, cwd: string): Promise<string> {
    if (isAbsolute(cwd)) throw new CheckRefusedError(`The check's folder "${cwd}" is absolute`);
    const rootReal = await realpath(root);
    const dir = resolve(rootReal, cwd);
    if (!within(rootReal, dir))
      throw new CheckRefusedError(`The check's folder "${cwd}" is outside the worktree`);
    const real = await realpath(dir).catch(() => {
      throw new CheckRefusedError(`The check's folder "${cwd}" doesn't exist`);
    });
    if (!within(rootReal, real))
      throw new CheckRefusedError(`The check's folder "${cwd}" leads outside the worktree`);
    return real;
  }

  async run(spec: CheckSpec): Promise<CheckOutcome> {
    const [program, ...args] = spec.argv;
    // Defence in depth: validatePlan already refused other programs.
    if (!program || !CHECK_PROGRAMS.has(program))
      throw new CheckRefusedError(`"${program ?? ""}" is not an allowed check program`);
    const cwd = await this.workdir(spec.root, spec.cwd);
    const env = checkEnv(await (this.o.env?.() ?? process.env));
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);

    // Resolved against the check's PATH, not the engine's: what the check would find.
    const exe = Bun.which(program, { PATH: env.PATH ?? "", cwd });
    if (!exe)
      return {
        ok: false,
        exitCode: null,
        durationMs: elapsed(),
        output: `${program} was not found on PATH`,
        timedOut: false,
        missing: true,
      };

    const posix = process.platform !== "win32";
    const proc = Bun.spawn([exe, ...args], {
      cwd,
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      // Its own process group, so a timeout can kill what it started too (pnpm → node → …).
      detached: posix,
    });
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (posix) process.kill(-proc.pid, signal);
        else proc.kill(signal);
      } catch {
        // Already gone.
      }
    };

    let timedOut = false;
    let hardKill: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(
      () => {
        timedOut = true;
        kill("SIGTERM");
        hardKill = setTimeout(() => kill("SIGKILL"), this.o.killGraceMs ?? KILL_GRACE_MS);
      },
      spec.timeoutMs ?? this.o.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS,
    );

    const tail = new Tail(CHECK_OUTPUT_CAP);
    const pumps = Promise.all([pump(proc.stdout, tail), pump(proc.stderr, tail)]);
    const exitCode = await proc.exited;
    clearTimeout(timer);
    clearTimeout(hardKill);
    // A straggler it left behind may hold the pipes open: give it a moment, then kill the
    // group and stop waiting.
    const drained = await Promise.race([pumps.then(() => true), Bun.sleep(DRAIN_GRACE_MS)]);
    if (!drained) {
      kill("SIGKILL");
      await Promise.race([pumps, Bun.sleep(DRAIN_GRACE_MS)]);
    }

    const killed = timedOut || proc.signalCode !== null;
    return {
      ok: !killed && exitCode === 0,
      exitCode: killed ? null : exitCode,
      durationMs: elapsed(),
      output: timedOut ? `${tail}\n[timed out]` : tail.toString(),
      timedOut,
      missing: false,
    };
  }
}
