// Git as far as squads need it: the user's repository, Gravita's worktrees and branches,
// commits made by Gravita, merges into the integration branch and delivery. Paths in and
// out are repo-relative with forward slashes, except folders (absolute).

export interface WorktreeSpec {
  /** Absolute path of the new worktree (under Gravita's data dir). */
  path: string;
  branch: string;
  /** Commit-ish the branch starts from when it doesn't exist yet. */
  from: string;
}

export type MergeOutcome = { ok: true; sha: string } | { ok: false; conflicts: string[] };

/** One conflicting file, for the user-facing conflict view. `null`: absent on that side. */
export interface ThreeWayFile {
  path: string;
  base: string | null;
  ours: string | null;
  theirs: string | null;
  /** A side was larger than the cap and was cut. */
  truncated: boolean;
}

export interface CommitOptions {
  message: string;
  /** A `Co-Authored-By` trailer value, "Name <email>". */
  coAuthor?: string;
  /** Commit only these paths; everything when absent. */
  paths?: readonly string[];
}

export interface GitWorkspace {
  /** True when `dir` is inside a git work tree. */
  isRepo(dir: string): Promise<boolean>;
  /** The work tree's top-level folder. */
  topLevel(dir: string): Promise<string>;
  /** True when `dir` exists and holds nothing (a lone .DS_Store counts as nothing). */
  isEmptyDir(dir: string): Promise<boolean>;
  /** Turns an empty folder into a repository on `main` with a first commit; returns its sha. */
  init(dir: string): Promise<string>;
  /** The checked-out branch, or null on a detached HEAD. */
  currentBranch(repo: string): Promise<string | null>;
  /** No staged, unstaged or untracked change (ignored files don't count). */
  isClean(repo: string): Promise<boolean>;
  /** The commit `ref` points at, or null when it doesn't resolve (e.g. no commit yet). */
  headSha(repo: string, ref?: string): Promise<string | null>;
  mergeBase(repo: string, a: string, b: string): Promise<string | null>;
  /** True when `path` exists in the tree of `ref`. */
  hasPath(repo: string, ref: string, path: string): Promise<boolean>;
  /** A file's text at `ref`, cut at `maxBytes`; null when the path isn't there. */
  readFile(
    repo: string,
    ref: string,
    path: string,
    maxBytes: number,
  ): Promise<{ text: string; truncated: boolean } | null>;

  /** Adds a worktree on `branch` (created from `from`). Idempotent for the same path and branch. */
  createWorktree(repo: string, spec: WorktreeSpec): Promise<void>;
  /** Removes a worktree (even with changes in it) and prunes stale entries. */
  removeWorktree(repo: string, path: string): Promise<void>;
  /** Deletes a local branch; a missing one is fine. */
  deleteBranch(repo: string, branch: string): Promise<void>;

  /**
   * Files changed in the worktree (staged, unstaged, untracked) and in its commits since it
   * left `base` (`base...HEAD`). A rename is reported as both paths.
   */
  changedFiles(worktree: string, base: string): Promise<string[]>;
  /** Stages everything (or `paths`) and commits as Gravita; null when there is nothing to commit. */
  commitAll(worktree: string, o: CommitOptions): Promise<string | null>;
  /** Puts `paths` back as they are in `from` (deleting the ones `from` doesn't have). */
  restorePaths(worktree: string, paths: readonly string[], from: string): Promise<void>;
  /**
   * Merges `branch` into the worktree's branch: a merge commit, or a fast-forward when
   * `fastForward` and possible. On conflict the merge is aborted and the worktree is unchanged.
   */
  merge(
    worktree: string,
    branch: string,
    o: { message: string; fastForward?: boolean },
  ): Promise<MergeOutcome>;
  /** Moves the worktree's branch back to `sha`, dropping every change (Gravita's branches only). */
  revertTo(worktree: string, sha: string): Promise<void>;
  /** Base, ours (the worktree's HEAD) and theirs (`branch`) of each path, size-capped. */
  threeWayDiff(worktree: string, branch: string, paths: readonly string[]): Promise<ThreeWayFile[]>;

  hasRemote(repo: string, remote?: string): Promise<boolean>;
  /** Pushes a local branch to the same name on `remote`. */
  push(repo: string, branch: string, remote?: string): Promise<void>;
}

/** Pull requests on the code host (GitHub through `gh`). */
export interface PullRequestHost {
  /** Why a pull request can't be opened, or null when it can. */
  unavailable(): Promise<"not-installed" | "not-logged-in" | null>;
  /** Opens a pull request and returns its url. */
  create(p: {
    repo: string;
    head: string;
    base: string;
    title: string;
    body: string;
  }): Promise<string>;
}
