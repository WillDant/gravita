import { open, readdir, readFile, stat } from "node:fs/promises";

export interface TranscriptStat {
  ino: number;
  size: number;
  mtimeMs: number;
}

/**
 * The only file-system calls the transcript readers make, injectable so tests can audit
 * them (same pattern as the engine's `RegistryFs`). Every call rejects when the path is
 * missing; nothing here ever writes.
 */
export interface TranscriptFs {
  stat(path: string): Promise<TranscriptStat>;
  readdir(path: string): Promise<string[]>;
  /** Up to `length` bytes starting at `position`; fewer (or none) at end of file. */
  readRange(path: string, position: number, length: number): Promise<Uint8Array>;
  readText(path: string): Promise<string>;
}

export const nodeTranscriptFs: TranscriptFs = {
  stat: (path) => stat(path),
  readdir: (path) => readdir(path),
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
  readText: (path) => readFile(path, "utf8"),
};
