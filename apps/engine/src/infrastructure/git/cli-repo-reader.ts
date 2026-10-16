import type { GitFileChange } from "@gravita/protocol";
import type { RepoReader, RepoStatus } from "../../application/ports/repo-reader";
import type { GitRunner } from "./git-runner";

// The user's repository through git, read-only: `status` and `diff` never take the index
// lock (GIT_OPTIONAL_LOCKS=0 in the runner), never run a textconv or external diff, and are
// capped so a huge change can't flood the UI.

const TIMEOUT_MS = 10_000;
/** The most diff text sent to the UI. */
export const MAX_DIFF_BYTES = 512 * 1024;
/** Untracked files shown as new, at most. */
const MAX_UNTRACKED = 50;
/** Pinned so the user's diff settings (noprefix, relative, textconv) can't change the output. */
const DIFF_ARGS = [
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--src-prefix=a/",
  "--dst-prefix=b/",
  "-M",
];

function changeOf(xy: string, kind: "1" | "2" | "u"): Pick<GitFileChange, "state" | "staged"> {
  const [x = ".", y = "."] = xy;
  if (kind === "u") return { state: "conflicted", staged: false };
  const staged = x !== ".";
  if (kind === "2") return { state: x === "C" || y === "C" ? "added" : "renamed", staged };
  if (x === "A") return { state: "added", staged };
  if (x === "D" || y === "D") return { state: "deleted", staged };
  return { state: "modified", staged };
}

/** Parses `git status --porcelain=v2 --branch -z`. */
export function parseStatus(out: string): Omit<RepoStatus, "root" | "hasRemote"> {
  const tokens = out.split("\0");
  const s: Omit<RepoStatus, "root" | "hasRemote"> = {
    branch: null,
    ahead: 0,
    behind: 0,
    files: [],
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as string;
    if (t.startsWith("# branch.oid ")) {
      const oid = t.slice(13);
      if (oid !== "(initial)") s.head = oid.slice(0, 7);
    } else if (t.startsWith("# branch.head ")) {
      const head = t.slice(14);
      s.branch = head === "(detached)" ? null : head;
    } else if (t.startsWith("# branch.upstream ")) {
      s.upstream = t.slice(18);
    } else if (t.startsWith("# branch.ab ")) {
      const m = /^\+(\d+) -(\d+)$/.exec(t.slice(12));
      if (m) {
        s.ahead = Number(m[1]);
        s.behind = Number(m[2]);
      }
    } else if (t.startsWith("1 ") || t.startsWith("2 ") || t.startsWith("u ")) {
      const kind = t[0] as "1" | "2" | "u";
      const parts = t.split(" ");
      const path = parts.slice(kind === "1" ? 8 : kind === "2" ? 9 : 10).join(" ");
      const change = changeOf(parts[1] ?? "..", kind);
      // A rename's former path is the next NUL-separated field.
      const from = kind === "2" ? tokens[++i] : undefined;
      s.files.push({ path, ...(from ? { from } : {}), ...change });
    } else if (t.startsWith("? ")) {
      s.files.push({ path: t.slice(2), state: "untracked", staged: false });
    }
  }
  return s;
}

export class CliRepoReader implements RepoReader {
  constructor(private readonly git: GitRunner) {}

  async status(dir: string): Promise<RepoStatus | null> {
    const top = await this.git.run(["rev-parse", "--show-toplevel"], {
      cwd: dir,
      timeoutMs: TIMEOUT_MS,
    });
    if (top.code !== 0) return null;
    const root = top.stdout.trim();
    const [status, remotes] = await Promise.all([
      this.git.ok(
        ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all", "--find-renames"],
        { cwd: root, timeoutMs: TIMEOUT_MS },
      ),
      this.git.run(["remote"], { cwd: root, timeoutMs: TIMEOUT_MS }),
    ]);
    return {
      root,
      ...parseStatus(status),
      hasRemote: remotes.code === 0 && remotes.stdout.trim() !== "",
    };
  }

  async diff(
    root: string,
    untracked: readonly string[],
  ): Promise<{ text: string; truncated: boolean }> {
    const opts = { cwd: root, timeoutMs: TIMEOUT_MS, maxOutputBytes: MAX_DIFF_BYTES };
    const head = await this.git.run(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], opts);
    // Before the first commit, everything is compared with the empty tree.
    const base =
      head.code === 0
        ? "HEAD"
        : (
            await this.git.ok(["hash-object", "-t", "tree", "--stdin"], { ...opts, input: "" })
          ).trim();
    const tracked = await this.git.run(["diff", ...DIFF_ARGS, base, "--"], opts);
    let text = tracked.code === 0 ? tracked.stdout : "";
    let truncated = tracked.truncated;
    for (const path of untracked.slice(0, MAX_UNTRACKED)) {
      const room = MAX_DIFF_BYTES - Buffer.byteLength(text);
      if (room <= 0 || truncated) break;
      // --no-index exits 1 when the files differ, which is always the case here.
      const r = await this.git.run(["diff", "--no-index", ...DIFF_ARGS, "--", "/dev/null", path], {
        ...opts,
        maxOutputBytes: room,
      });
      text += r.stdout;
      truncated = r.truncated;
    }
    if (untracked.length > MAX_UNTRACKED) truncated = true;
    // A cut diff ends on a whole line.
    if (truncated) text = text.slice(0, text.lastIndexOf("\n") + 1);
    return { text, truncated };
  }
}
