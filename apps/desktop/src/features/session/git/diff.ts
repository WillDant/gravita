// A unified diff (`git diff`) cut into files, for the Git panel.

export type DiffLineKind = "add" | "del" | "context" | "hunk" | "note";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

export interface FileDiff {
  /** The new path (the old one for a deletion). */
  path: string;
  lines: DiffLine[];
  additions: number;
  deletions: number;
  binary: boolean;
}

/** `a/x` or `b/x` → `x`; `/dev/null` stays absent. */
function side(raw: string | undefined): string | undefined {
  if (!raw || raw === "/dev/null") return undefined;
  const p = raw.replace(/\t.*$/, "");
  return p.startsWith("a/") || p.startsWith("b/") ? p.slice(2) : p;
}

/** The path a `diff --git a/x b/y` header names when there is no ---/+++ (binary, mode only). */
function headerPath(line: string): string {
  const rest = line.slice("diff --git ".length);
  const b = rest.lastIndexOf(" b/");
  return b >= 0 ? rest.slice(b + 3) : rest;
}

export function parseDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  let cur: FileDiff | undefined;
  let inHunk = false;
  let oldPath: string | undefined;
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      cur = { path: headerPath(line), lines: [], additions: 0, deletions: 0, binary: false };
      files.push(cur);
      inHunk = false;
      oldPath = undefined;
      continue;
    }
    if (!cur) continue;
    if (!inHunk) {
      if (line.startsWith("--- ")) oldPath = side(line.slice(4));
      else if (line.startsWith("+++ ")) cur.path = side(line.slice(4)) ?? oldPath ?? cur.path;
      else if (line.startsWith("rename to ")) cur.path = line.slice(10);
      else if (line.startsWith("Binary files ")) cur.binary = true;
      else if (line.startsWith("@@")) {
        inHunk = true;
        cur.lines.push({ kind: "hunk", text: line });
      }
      continue;
    }
    if (line.startsWith("@@")) cur.lines.push({ kind: "hunk", text: line });
    else if (line.startsWith("+")) {
      cur.additions++;
      cur.lines.push({ kind: "add", text: line });
    } else if (line.startsWith("-")) {
      cur.deletions++;
      cur.lines.push({ kind: "del", text: line });
    } else if (line.startsWith("\\")) cur.lines.push({ kind: "note", text: line });
    else if (line.startsWith(" ")) cur.lines.push({ kind: "context", text: line });
  }
  return files;
}
