import { open, readFile, stat } from "node:fs/promises";

export interface RolloutStat {
  ino: number;
  size: number;
  mtimeMs: number;
}

/**
 * The only file-system calls the rollout readers make, injectable so tests can audit them.
 * Every call rejects when the path is missing; nothing here ever writes.
 */
export interface RolloutFs {
  stat(path: string): Promise<RolloutStat>;
  /** Up to `length` bytes starting at `position`; fewer (or none) at end of file. */
  readRange(path: string, position: number, length: number): Promise<Uint8Array>;
  /** The whole file (compressed rollouts are read in one go). */
  readFile(path: string): Promise<Uint8Array>;
}

export const nodeRolloutFs: RolloutFs = {
  stat: (path) => stat(path),
  async readRange(path, position, length) {
    const fh = await open(path, "r");
    try {
      const buf = Buffer.allocUnsafe(length);
      const { bytesRead } = await fh.read(buf, 0, length, position);
      return buf.subarray(0, bytesRead);
    } finally {
      await fh.close();
    }
  },
  readFile: (path) => readFile(path),
};

/** Some Codex versions compress finished rollouts with zstd (`.jsonl.zst`). */
export const isCompressed = (path: string) => path.endsWith(".zst");

/**
 * Decompresses a zstd rollout with Bun's built-in codec. Null when this runtime has none or
 * the data isn't a complete frame yet (a file still being written): the caller skips it.
 */
export function decompressRollout(bytes: Uint8Array): Uint8Array | null {
  const codec = (globalThis as { Bun?: { zstdDecompressSync?: (b: Uint8Array) => Uint8Array } }).Bun
    ?.zstdDecompressSync;
  if (!codec) return null;
  try {
    return codec(bytes);
  } catch {
    return null;
  }
}
