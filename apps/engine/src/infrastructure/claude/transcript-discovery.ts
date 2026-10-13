import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Clock } from "../../application/ports/clock";

// Finds Claude Code transcripts under <claudeHome>/projects/*/<session>.jsonl.
// Read-only: nothing is ever written under claudeHome.

const SESSION_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i;
const DAY_MS = 86_400_000;
/** Transcripts older than the lookback window are re-checked this rarely. */
const STALE_RECHECK_MS = 60_000;

export interface FoundTranscript {
  sessionId: string;
  path: string;
  mtimeMs: number;
  size: number;
}

export interface TranscriptDiscoveryOptions {
  claudeHome: string;
  lookbackDays: number;
  clock: Clock;
  /** True while the session's process is alive (registry): never skipped as stale. */
  isLive: (sessionId: string) => boolean;
}

export class TranscriptDiscovery {
  /** Out-of-window transcripts → when to stat them again. */
  private readonly stale = new Map<string, number>();

  constructor(private readonly o: TranscriptDiscoveryOptions) {}

  /**
   * Every transcript worth looking at: the ones already known (so their mtime and size
   * stay fresh) and new ones written within the lookback window.
   */
  async scan(isKnown: (sessionId: string) => boolean): Promise<FoundTranscript[]> {
    const root = join(this.o.claudeHome, "projects");
    const cutoff = this.o.clock.now() - this.o.lookbackDays * DAY_MS;
    let dirs: Dirent[];
    try {
      dirs = await readdir(root, { withFileTypes: true });
    } catch {
      return [];
    }
    const found: FoundTranscript[] = [];
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      let entries: Dirent[];
      try {
        entries = await readdir(join(root, d.name), { withFileTypes: true });
      } catch {
        continue;
      }
      for (const f of entries) {
        // isFile() is false for symlinks: never follow a link out of the transcripts tree.
        if (!f.isFile() || !SESSION_FILE.test(f.name)) continue;
        const path = join(root, d.name, f.name);
        const sessionId = f.name.slice(0, -".jsonl".length);
        const recheckAt = this.stale.get(path);
        if (recheckAt !== undefined && this.o.clock.now() < recheckAt && !this.o.isLive(sessionId))
          continue;
        const st = await stat(path).catch(() => null);
        if (!st) continue;
        const t = { sessionId, path, mtimeMs: st.mtimeMs, size: st.size };
        if (isKnown(sessionId)) {
          found.push(t);
          continue;
        }
        if (st.mtimeMs < cutoff) {
          this.stale.set(path, this.o.clock.now() + STALE_RECHECK_MS);
          continue;
        }
        this.stale.delete(path);
        found.push(t);
      }
    }
    return found;
  }
}
