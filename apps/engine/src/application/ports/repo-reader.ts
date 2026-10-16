import type { GitFileChange, PullRequestInfo } from "@gravita/protocol";

// The user's repository as the session screen shows it: read-only, never a write or a lock.

export interface RepoStatus {
  /** The work tree's top-level folder. */
  root: string;
  /** null on a detached HEAD. */
  branch: string | null;
  /** Short sha of HEAD; absent before the first commit. */
  head?: string;
  upstream?: string;
  ahead: number;
  behind: number;
  files: GitFileChange[];
  /** The repository has at least one remote. */
  hasRemote: boolean;
}

export interface RepoReader {
  /** The repository `dir` is in, or null when it isn't in a work tree. */
  status(dir: string): Promise<RepoStatus | null>;
  /** Unified diff of every change against HEAD, plus `untracked` files as new ones. */
  diff(root: string, untracked: readonly string[]): Promise<{ text: string; truncated: boolean }>;
}

export type PullRequestLookup =
  | { pr: PullRequestInfo | null }
  | { unavailable: "not-installed" | "not-logged-in" | "failed" };

/** The pull request of the branch checked out in `repo`, on the code host. */
export interface PullRequestReader {
  current(repo: string): Promise<PullRequestLookup>;
}
