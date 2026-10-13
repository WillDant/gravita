import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { EngineStatus } from "@gravita/protocol";

export type ClaudeStatus = EngineStatus["claude"];

/** Nested subagent forwarding needs at least this CLI version. */
export const MIN_CLAUDE_VERSION = "2.1.219";

export function knownClaudePaths(home = homedir()): string[] {
  return [
    join(home, ".local/bin/claude"),
    join(home, ".claude/local/claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ];
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

async function run(cmd: string[], timeoutMs: number): Promise<{ code: number; stdout: string }> {
  try {
    const proc = Bun.spawn(cmd, {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
      timeout: timeoutMs,
    });
    const stdout = await new Response(proc.stdout).text();
    return { code: await proc.exited, stdout };
  } catch {
    return { code: -1, stdout: "" };
  }
}

/** Picks the path out of `command -v` output, which may be noisy or an alias. */
export function pathFromCommandV(stdout: string): string | undefined {
  const lines = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .reverse();
  for (const line of lines) {
    if (line.startsWith("/")) return line;
    const alias = line.match(/^alias claude=['"]?(\/[^'"\s]+)/);
    if (alias) return alias[1];
  }
  return undefined;
}

export interface DetectOptions {
  shell?: string;
  knownPaths?: string[];
}

/**
 * Finds the `claude` CLI through the login shell and known install paths, and reads
 * its version. Runs `claude --version` and nothing else.
 */
export async function detectClaude(opts: DetectOptions = {}): Promise<ClaudeStatus> {
  const shell = opts.shell ?? process.env.SHELL ?? "/bin/sh";
  const viaShell = pathFromCommandV(
    (await run([shell, "-lic", "command -v claude"], 5_000)).stdout,
  );
  const candidates = [
    ...new Set([...(viaShell ? [viaShell] : []), ...(opts.knownPaths ?? knownClaudePaths())]),
  ];
  for (const path of candidates) {
    try {
      await access(path, constants.X_OK);
    } catch {
      continue;
    }
    const r = await run([path, "--version"], 10_000);
    if (r.code !== 0) continue;
    const version = r.stdout.match(/\d+\.\d+\.\d+/)?.[0];
    if (!version) return { found: true, path };
    return {
      found: true,
      path,
      version,
      outdated: compareVersions(version, MIN_CLAUDE_VERSION) < 0,
    };
  }
  return { found: false };
}
