import { constants } from "node:fs";
import { access } from "node:fs/promises";
import type { ProviderStatus } from "@gravita/protocol";

// Finds a provider's CLI the way the user's own terminal would (their login shell's
// `command -v`, then the usual install paths) and reads its version. Shared by every
// provider's detector; it runs `<cli> --version` and nothing else.

/** Compares dotted versions numerically ("2.10.0" > "2.9.1"); negative when a < b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Picks the path of `binary` out of `command -v` output, which may be noisy or an alias. */
export function pathFromCommandV(stdout: string, binary: string): string | undefined {
  const aliasLine = new RegExp(`^alias ${escapeRegExp(binary)}=['"]?(/[^'"\\s]+)`);
  const lines = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .reverse();
  for (const line of lines) {
    if (line.startsWith("/")) return line;
    const alias = line.match(aliasLine);
    if (alias) return alias[1];
  }
  return undefined;
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

export interface CliSearch {
  /** The command name, e.g. "claude". */
  binary: string;
  /** Install locations to try after the login shell's answer. */
  knownPaths: readonly string[];
  /** Older versions are reported `outdated`. */
  minVersion: string;
  /** The login shell to ask (default: $SHELL, else /bin/sh). */
  shell?: string;
}

/** Finds the CLI and reads its version; `{ found: false }` when no candidate runs. */
export async function detectCli(o: CliSearch): Promise<ProviderStatus> {
  const shell = o.shell ?? process.env.SHELL ?? "/bin/sh";
  const viaShell = pathFromCommandV(
    (await run([shell, "-lic", `command -v ${o.binary}`], 5_000)).stdout,
    o.binary,
  );
  const candidates = [...new Set([...(viaShell ? [viaShell] : []), ...o.knownPaths])];
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
      outdated: compareVersions(version, o.minVersion) < 0,
    };
  }
  return { found: false };
}
