import type { AgentEnvironmentSource } from "../../application/ports/agent-environment";
import type { CursorKeyCheck, CursorKeyValidator } from "../../application/ports/credential-source";
import { cursorChatEnv } from "./cursor-environment";

// Checks a Cursor API key the way the spike settled on (T01): `cursor-agent models` in the
// same from-scratch environment as a chat. It lists the account's models when the key is
// good, and says so when Cursor refused it. Nothing it prints is logged: it could hold the
// key.

/** How long the check may take before Cursor counts as unreachable. */
export const VALIDATE_TIMEOUT_MS = 20_000;

export interface CommandResult {
  /** The exit code; null when it was killed (timed out) or never started. */
  code: number | null;
  output: string;
}

/** Runs a command with exactly `env`; tests replace it. */
export type RunWithEnv = (
  cmd: string[],
  env: Record<string, string>,
  timeoutMs: number,
) => Promise<CommandResult>;

export const runWithEnv: RunWithEnv = async (cmd, env, timeoutMs) => {
  try {
    const proc = Bun.spawn(cmd, {
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: timeoutMs,
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const code = await proc.exited;
    return { code: proc.signalCode ? null : code, output: `${stdout}\n${stderr}` };
  } catch {
    return { code: null, output: "" };
  }
};

/** Cursor's refusals of a key, as `cursor-agent` words them. */
const REFUSED = /api key is invalid|invalid or expired|unauthori[sz]ed|authentication required/i;

/** What `cursor-agent models` says of the key it ran with. */
export function classifyModelsOutput(r: CommandResult): CursorKeyCheck {
  if (r.code === 0) return "valid";
  if (r.code !== null && REFUSED.test(r.output)) return "invalid";
  // Unreachable (no network, a proxy), timed out, or something else: not a verdict.
  return "unchecked";
}

export class CursorCliKeyValidator implements CursorKeyValidator {
  constructor(
    private readonly environment: AgentEnvironmentSource,
    private readonly run: RunWithEnv = runWithEnv,
    private readonly timeoutMs = VALIDATE_TIMEOUT_MS,
  ) {}

  async validate(key: string): Promise<CursorKeyCheck> {
    let cli: Awaited<ReturnType<AgentEnvironmentSource["load"]>>;
    try {
      cli = await this.environment.load();
    } catch {
      return "unchecked";
    }
    const r = await this.run([cli.cliPath, "models"], cursorChatEnv(cli.env, key), this.timeoutMs);
    return classifyModelsOutput(r);
  }
}
