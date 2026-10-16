import type { GitInfo } from "@gravita/protocol";
import { InvalidCwdError } from "../../domain/errors";
import type { PullRequestLookup, PullRequestReader, RepoReader } from "../ports/repo-reader";
import type { Workspace } from "../ports/workspace";

/** The repository a session works in: its branch, its changes and the branch's pull request. */
export class GetGitInfo {
  constructor(
    private readonly d: { workspace: Workspace; repo: RepoReader; prs?: PullRequestReader },
  ) {}

  async execute(p: { cwd: string; summary?: boolean }): Promise<GitInfo> {
    if (!(await this.d.workspace.isDirectory(p.cwd))) throw new InvalidCwdError(p.cwd);
    const status = await this.d.repo.status(p.cwd);
    if (!status) return { repo: false };
    const { hasRemote, ...rest } = status;
    if (p.summary) return { repo: true, ...rest, diff: "", diffTruncated: false, pr: null };
    const untracked = status.files.filter((f) => f.state === "untracked").map((f) => f.path);
    const lookup = async (): Promise<PullRequestLookup> => {
      if (!this.d.prs) return { unavailable: "not-installed" };
      // No remote or no branch: there is no pull request to look for.
      return hasRemote && status.branch ? this.d.prs.current(status.root) : { pr: null };
    };
    const [diff, found] = await Promise.all([this.d.repo.diff(status.root, untracked), lookup()]);
    const unavailable =
      "unavailable" in found ? found.unavailable : hasRemote ? undefined : "no-remote";
    return {
      repo: true,
      ...rest,
      diff: diff.text,
      diffTruncated: diff.truncated,
      pr: "pr" in found ? found.pr : null,
      ...(unavailable ? { prUnavailable: unavailable } : {}),
    };
  }
}
