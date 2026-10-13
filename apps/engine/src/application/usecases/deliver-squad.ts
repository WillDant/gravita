import { type DeliverMode, keys } from "@gravita/protocol";
import { DirtyWorktreeError, GhUnavailableError, SquadWorkspaceError } from "../../domain/errors";
import type { Clock } from "../ports/clock";
import type { GitWorkspace, PullRequestHost } from "../ports/git-workspace";
import { squadEvent } from "../services/squad-events";
import type { IngestEvents } from "./ingest-events";

export interface DeliverSquadParams {
  squadId: string;
  projectId: string;
  mode: DeliverMode;
  /** The user's repository. */
  repo: string;
  baseBranch: string;
  integrationBranch: string;
  /** The squad's goal; the merge commit's subject and the pull request's title. */
  title: string;
  body: string;
}

export type DeliverResult =
  | { delivered: true; ref: string }
  /** The base branch moved and now conflicts with integration; nothing was changed. */
  | { delivered: false; conflicts: string[] };

/**
 * Hands the squad's work to the user, as they chose on the Board:
 * - `branch`: nothing to do, the integration branch is theirs to look at;
 * - `merge`: merges integration into their base branch, in their own checkout. It is the one
 *   place Gravita writes to the user's branch, and only on their explicit click: the
 *   checkout must be on the base branch and clean;
 * - `pr`: pushes integration and opens a pull request with their GitHub CLI.
 */
export class DeliverSquad {
  constructor(
    private readonly d: {
      git: GitWorkspace;
      pullRequests: PullRequestHost;
      ingest: IngestEvents;
      clock: Clock;
    },
  ) {}

  async execute(p: DeliverSquadParams): Promise<DeliverResult> {
    const ref = await this.deliver(p);
    if (typeof ref !== "string") return ref;
    this.d.ingest.execute([
      squadEvent(
        "squad.delivered",
        { key: keys.squadDelivered(p.squadId), ts: this.d.clock.iso(), projectId: p.projectId },
        { squadId: p.squadId, mode: p.mode, ref },
      ),
    ]);
    return { delivered: true, ref };
  }

  private async deliver(p: DeliverSquadParams): Promise<string | DeliverResult> {
    const { git } = this.d;
    switch (p.mode) {
      case "branch":
        return p.integrationBranch;
      case "merge": {
        const current = await git.currentBranch(p.repo);
        if (current !== p.baseBranch)
          throw new SquadWorkspaceError(
            "wrong-branch",
            `Check out "${p.baseBranch}" in your repository to merge the squad's work (it is on ${current ? `"${current}"` : "a detached HEAD"})`,
          );
        if (!(await git.isClean(p.repo))) throw new DirtyWorktreeError(p.repo);
        const merged = await git.merge(p.repo, p.integrationBranch, {
          message: `Gravita squad: ${p.title}`,
        });
        return merged.ok ? p.baseBranch : { delivered: false, conflicts: merged.conflicts };
      }
      case "pr": {
        if (!(await git.hasRemote(p.repo))) throw new GhUnavailableError("no-remote");
        const why = await this.d.pullRequests.unavailable();
        if (why) throw new GhUnavailableError(why);
        await git.push(p.repo, p.integrationBranch);
        return this.d.pullRequests.create({
          repo: p.repo,
          head: p.integrationBranch,
          base: p.baseBranch,
          title: p.title,
          body: p.body,
        });
      }
    }
  }
}
