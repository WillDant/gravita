import { isAbsolute, join, relative, sep } from "node:path";
import type { FsEntry, FsReadResult } from "@gravita/protocol";
import {
  FileConflictError,
  FileNotFoundError,
  InvalidCwdError,
  PathOutsideRootError,
} from "../../domain/errors";
import type { FileTree } from "../ports/file-tree";
import type { Workspace } from "../ports/workspace";

/** Larger files aren't opened in the editor. */
export const MAX_EDITABLE_BYTES = 2 * 1024 * 1024;
/** A NUL byte in this much of the start marks a file as binary. */
const SNIFF_BYTES = 8 * 1024;
const HIDDEN = new Set([".git"]);

/**
 * A session's folder for the file explorer: list a folder, read a file, save it. Nothing
 * outside `root` is reached, whether by `..` or by a symlink that leads out.
 */
export class ProjectFiles {
  constructor(private readonly d: { workspace: Workspace; files: FileTree }) {}

  async list(p: { root: string; path: string }): Promise<{ entries: FsEntry[] }> {
    const dir = await this.resolve(p.root, p.path);
    if ((await this.d.files.stat(dir))?.kind !== "dir") throw new FileNotFoundError(p.path);
    const entries = (await this.d.files.list(dir)).filter((e) => !HIDDEN.has(e.name));
    entries.sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1,
    );
    return { entries };
  }

  async read(p: { root: string; path: string }): Promise<FsReadResult> {
    const file = await this.resolve(p.root, p.path);
    const s = await this.d.files.stat(file);
    if (s?.kind !== "file") throw new FileNotFoundError(p.path);
    if (s.size > MAX_EDITABLE_BYTES) return { kind: "tooLarge", size: s.size };
    const bytes = await this.d.files.read(file);
    if (bytes.subarray(0, SNIFF_BYTES).includes(0)) return { kind: "binary" };
    return { kind: "text", text: new TextDecoder().decode(bytes), mtimeMs: s.mtimeMs };
  }

  async write(p: {
    root: string;
    path: string;
    text: string;
    expectedMtimeMs?: number;
  }): Promise<{ mtimeMs: number }> {
    const file = await this.resolve(p.root, p.path);
    const s = await this.d.files.stat(file);
    if (s?.kind !== "file") throw new FileNotFoundError(p.path);
    if (p.expectedMtimeMs !== undefined && s.mtimeMs !== p.expectedMtimeMs)
      throw new FileConflictError(p.path);
    return { mtimeMs: await this.d.files.write(file, p.text) };
  }

  /** `path` (relative to `root`) as a real path inside the real `root`. */
  private async resolve(root: string, path: string): Promise<string> {
    if (!(await this.d.workspace.isDirectory(root))) throw new InvalidCwdError(root);
    const base = await this.d.files.realpath(root);
    if (!base) throw new InvalidCwdError(root);
    if (isAbsolute(path) || path.includes("\0")) throw new PathOutsideRootError(path);
    const target = join(base, path);
    if (!inside(base, target)) throw new PathOutsideRootError(path);
    const real = await this.d.files.realpath(target);
    if (!real) throw new FileNotFoundError(path);
    if (!inside(base, real)) throw new PathOutsideRootError(path);
    return real;
  }
}

function inside(base: string, path: string): boolean {
  const rel = relative(base, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}
