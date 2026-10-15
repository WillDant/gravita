import type { ForegroundProbe } from "../../application/ports/terminal-host";

interface Row {
  pid: number;
  pgid: number;
  tpgid: number;
  command: string;
}

export function parsePs(output: string): Row[] {
  const rows: Row[] = [];
  for (const line of output.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(-?\d+)\s+(.*)$/.exec(line);
    if (m)
      rows.push({
        pid: Number(m[1]),
        pgid: Number(m[2]),
        tpgid: Number(m[3]),
        command: m[4] ?? "",
      });
  }
  return rows;
}

/** For each shell, the commands of its terminal's foreground process group. */
export function foregroundOf(
  rows: readonly Row[],
  shellPids: readonly number[],
): Map<number, string[]> {
  const found = new Map<number, string[]>();
  for (const pid of shellPids) {
    const shell = rows.find((r) => r.pid === pid);
    if (!shell || shell.tpgid <= 0) continue;
    found.set(
      pid,
      rows.filter((r) => r.pgid === shell.tpgid).map((r) => r.command),
    );
  }
  return found;
}

/** Reads the process table with `ps` (macOS and Linux): one call looks at every shell. */
export class PsForegroundProbe implements ForegroundProbe {
  async foreground(shellPids: readonly number[]): Promise<Map<number, string[]>> {
    if (shellPids.length === 0) return new Map();
    const proc = Bun.spawn(["ps", "-wwaxo", "pid=,pgid=,tpgid=,command="], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    return foregroundOf(parsePs(text), shellPids);
  }
}
