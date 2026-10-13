import { mkdir, readdir, readFile, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { HookSpool } from "../../application/ports/hook-spool";

// `<dataDir>/spool/hooks.jsonl`: the Deep Observe plugin appends one JSON line per hook
// while the engine is unreachable. A drain renames it first (`hooks-<ms>.processing`) so
// the plugin starts a new file, then ingests and deletes the renamed one. A pass that was
// cut short (crash) leaves its `.processing` file, which the next pass picks up first.

export const SPOOL_FILE = "hooks.jsonl";
/** The plugin stops writing at ~5 MB; anything far larger wasn't written by it. */
const MAX_SPOOL_BYTES = 16 * 1024 * 1024;
/** Lets a hook that was mid-append when the file was renamed finish its line. */
const SETTLE_MS = 50;

export class FsHookSpool implements HookSpool {
  constructor(
    private readonly dir: string,
    private readonly now: () => number = Date.now,
  ) {}

  async drain(each: (payload: unknown) => Promise<void>): Promise<number> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const live = join(this.dir, SPOOL_FILE);
    const renamed = await rename(live, join(this.dir, `hooks-${this.now()}.processing`)).then(
      () => true,
      (err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT") return false;
        throw err;
      },
    );
    if (renamed) await Bun.sleep(SETTLE_MS);
    const batches = (await readdir(this.dir))
      .filter((n) => /^hooks-\d+\.processing$/.test(n))
      .sort((a, b) => Number(a.slice(6, -11)) - Number(b.slice(6, -11)));
    let handed = 0;
    for (const name of batches) {
      const path = join(this.dir, name);
      if ((await stat(path)).size <= MAX_SPOOL_BYTES) {
        for (const line of (await readFile(path, "utf8")).split("\n")) {
          const payload = parseLine(line);
          if (payload === undefined) continue;
          await each(payload);
          handed++;
        }
      }
      await unlink(path);
    }
    return handed;
  }
}

function parseLine(line: string): unknown {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}
