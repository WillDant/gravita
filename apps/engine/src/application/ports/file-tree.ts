import type { FsEntry } from "@gravita/protocol";

// The project's files as the explorer and editor see them. Paths here are absolute; the use
// case has already checked that they stay inside the project.

export interface FileStat {
  kind: "file" | "dir" | "other";
  size: number;
  mtimeMs: number;
}

export interface FileTree {
  /** The real path (symlinks resolved), or null when nothing is there. */
  realpath(path: string): Promise<string | null>;
  stat(path: string): Promise<FileStat | null>;
  /** A folder's entries, unsorted; anything that is neither a file nor a folder is left out. */
  list(dir: string): Promise<FsEntry[]>;
  read(path: string): Promise<Uint8Array>;
  /** Replaces the file in one step (a temporary file renamed over it); returns the new mtime. */
  write(path: string, text: string): Promise<number>;
}
