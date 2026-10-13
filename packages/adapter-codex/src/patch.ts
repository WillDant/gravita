// Codex edits files through `apply_patch`, whose input is a patch in its own envelope:
//
//   *** Begin Patch
//   *** Add File: src/new.ts        (every following "+" line is the new file)
//   *** Update File: src/old.ts     (hunks of " ", "-" and "+" lines; "*** Move to:" renames)
//   *** Delete File: src/gone.ts
//   *** End Patch
//
// Only the headers and line prefixes are read: which files change, and how many lines.

export interface PatchFile {
  path: string;
  op: "add" | "update" | "delete";
  /** Set when an update also renames the file. */
  movedTo?: string;
  added: number;
  removed: number;
}

const HEADER = /^\*\*\* (Add|Update|Delete) File: (.+)$/;
const MOVE = /^\*\*\* Move to: (.+)$/;

/** The files a patch touches, in order. Empty when the text holds no patch headers. */
export function parsePatch(text: string): PatchFile[] {
  const out: PatchFile[] = [];
  let current: PatchFile | undefined;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const header = line.match(HEADER);
    if (header) {
      const op = header[1] === "Add" ? "add" : header[1] === "Update" ? "update" : "delete";
      current = { path: header[2]!.trim(), op, added: 0, removed: 0 };
      out.push(current);
      continue;
    }
    if (!current) continue;
    const move = line.match(MOVE);
    if (move) {
      current.movedTo = move[1]!.trim();
      continue;
    }
    if (line.startsWith("***")) {
      // "*** End Patch", "*** End of File": no more lines for this file.
      if (!line.startsWith("*** End of File")) current = undefined;
      continue;
    }
    if (line.startsWith("+")) current.added++;
    else if (line.startsWith("-") && current.op !== "add") current.removed++;
  }
  return out;
}

/** Every path a patch writes: each file, and the new name of a renamed one. */
export function patchPaths(files: readonly PatchFile[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (!out.includes(f.path)) out.push(f.path);
    if (f.movedTo && !out.includes(f.movedTo)) out.push(f.movedTo);
  }
  return out;
}

/** `tool.completed` file changes: the path a file ends up at, with its line counts. */
export function fileChangesOf(
  files: readonly PatchFile[],
): { path: string; added: number; removed: number }[] {
  return files.map((f) => ({ path: f.movedTo ?? f.path, added: f.added, removed: f.removed }));
}
