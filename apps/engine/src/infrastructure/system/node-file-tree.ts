import { randomBytes } from "node:crypto";
import { readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { FsEntry } from "@gravita/protocol";
import type { FileStat, FileTree } from "../../application/ports/file-tree";

export class NodeFileTree implements FileTree {
  async realpath(path: string): Promise<string | null> {
    try {
      return await realpath(path);
    } catch {
      return null;
    }
  }

  async stat(path: string): Promise<FileStat | null> {
    try {
      const s = await stat(path);
      return {
        kind: s.isFile() ? "file" : s.isDirectory() ? "dir" : "other",
        size: s.size,
        mtimeMs: s.mtimeMs,
      };
    } catch {
      return null;
    }
  }

  async list(dir: string): Promise<FsEntry[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const out: FsEntry[] = [];
    for (const e of entries) {
      if (e.isDirectory()) out.push({ name: e.name, kind: "dir" });
      else if (e.isFile()) out.push({ name: e.name, kind: "file" });
      else if (e.isSymbolicLink()) {
        // A link shows as what it points to; a broken one isn't shown.
        const target = await this.stat(join(dir, e.name));
        if (target?.kind === "dir" || target?.kind === "file")
          out.push({ name: e.name, kind: target.kind });
      }
    }
    return out;
  }

  read(path: string): Promise<Uint8Array> {
    return readFile(path);
  }

  async write(path: string, text: string): Promise<number> {
    const tmp = join(dirname(path), `.${basename(path)}.${randomBytes(4).toString("hex")}.tmp`);
    // The new file keeps the old one's permissions (an executable script stays executable).
    const mode = (await stat(path).catch(() => undefined))?.mode;
    try {
      await writeFile(tmp, text, mode === undefined ? undefined : { mode });
      await rename(tmp, path);
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
    return (await stat(path)).mtimeMs;
  }
}
