// The environment Claude Code runs with: the user's login shell environment (a desktop app
// launched from the Dock doesn't inherit what their shell profile exports), reduced to an
// allowlist. Values are never logged.

/** Variables passed through by exact name. */
const EXACT = new Set([
  "PATH",
  "HOME",
  "USER",
  "LANG",
  "SHELL",
  "TMPDIR",
  "NODE_EXTRA_CA_CERTS",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "all_proxy",
]);

/** Variables passed through by prefix (locale, Anthropic/Claude Code, Bedrock, Vertex). */
const PREFIXES = ["LC_", "ANTHROPIC_", "CLAUDE_CODE_", "AWS_", "GOOGLE_", "CLOUD_ML_", "VERTEX"];

/**
 * Within the allowed prefixes: what a parent Claude Code process injects into its children
 * (session and host identity, IPC sockets and tokens, entrypoint, simple mode). Present only
 * when the engine itself was started from inside a Claude Code session; passing them on would
 * spoof Claude Code's identity or attach the new session to someone else's.
 */
const HOST_SCOPED =
  /^CLAUDE_CODE_(ENTRYPOINT|SESSION_ID|HOST_SESSION_ID|CHILD_SESSION|SESSION_ATTENDED|MESSAGING_\w+|EXECPATH|DESKTOP_APP_VERSION|SDK_HAS_HOST_AUTH_REFRESH|ACCOUNT_UUID|ORGANIZATION_UUID|USER_EMAIL|OAUTH_SCOPES|SIMPLE)$/;

export function isAllowedEnvKey(key: string): boolean {
  if (HOST_SCOPED.test(key)) return false;
  return EXACT.has(key) || PREFIXES.some((p) => key.startsWith(p));
}

/** Keeps only allowlisted, non-empty variables. */
export function filterClaudeEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string" && v !== "" && isAllowedEnvKey(k)) out[k] = v;
  }
  return out;
}

/** Marks where `env -0` output starts, after whatever the shell profile printed. */
export const ENV_MARKER = "__GRAVITA_ENV_BEGIN__";

/** Parses `env -0` output that follows `ENV_MARKER`. */
export function parseEnv0(output: string): Record<string, string> {
  const at = output.indexOf(`${ENV_MARKER}\0`);
  if (at < 0) return {};
  const out: Record<string, string> = {};
  for (const entry of output.slice(at + ENV_MARKER.length + 1).split("\0")) {
    const eq = entry.indexOf("=");
    if (eq <= 0) continue;
    out[entry.slice(0, eq)] = entry.slice(eq + 1);
  }
  return out;
}

/** Runs a command; resolves with its stdout, or null on failure or timeout. */
export type RunCommand = (cmd: string[], timeoutMs: number) => Promise<string | null>;

const runCommand: RunCommand = async (cmd, timeoutMs) => {
  try {
    const proc = Bun.spawn(cmd, {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
      timeout: timeoutMs,
    });
    const stdout = await new Response(proc.stdout).text();
    return (await proc.exited) === 0 ? stdout : null;
  } catch {
    return null;
  }
};

export interface LoginShellEnvOptions {
  /** The user's shell; defaults to $SHELL. */
  shell?: string;
  timeoutMs?: number;
  run?: RunCommand;
  /** Used when the shell fails or times out (filtered the same way). */
  fallback?: Record<string, string | undefined>;
}

/** Captures the login shell's environment once (`$SHELL -lic 'env -0'`, 5 s timeout). */
export class LoginShellEnv {
  private cached: Promise<Record<string, string>> | undefined;

  constructor(private readonly o: LoginShellEnvOptions = {}) {}

  load(): Promise<Record<string, string>> {
    this.cached ??= this.capture();
    return this.cached;
  }

  private async capture(): Promise<Record<string, string>> {
    const shell = this.o.shell ?? process.env.SHELL ?? "/bin/sh";
    const out = await (this.o.run ?? runCommand)(
      [shell, "-lic", `printf '%s\\0' ${ENV_MARKER}; env -0`],
      this.o.timeoutMs ?? 5_000,
    );
    const env = out ? parseEnv0(out) : {};
    if (env.PATH) return filterClaudeEnv(env);
    return filterClaudeEnv(this.o.fallback ?? process.env);
  }
}
