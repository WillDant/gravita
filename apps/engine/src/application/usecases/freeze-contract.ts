import { keys } from "@gravita/protocol";
import { SquadWorkspaceError } from "../../domain/errors";
import { squadLayout } from "../../domain/squad-workspace";
import type { Clock } from "../ports/clock";
import type { GitWorkspace } from "../ports/git-workspace";
import { squadEvent } from "../services/squad-events";
import type { IngestEvents } from "./ingest-events";

export interface FreezeContractParams {
  squadId: string;
  projectId: string;
  /** The contract file, repo-relative. */
  path: string;
  version: number;
}

/**
 * Records that a contract (OpenAPI, shared types…) is frozen at a version: the integration
 * head that holds it is the reference every role builds against.
 */
export class FreezeContract {
  constructor(
    private readonly d: {
      git: GitWorkspace;
      ingest: IngestEvents;
      clock: Clock;
      worktreesRoot: string;
    },
  ) {}

  async execute(p: FreezeContractParams): Promise<{ sha: string }> {
    const integration = squadLayout(this.d.worktreesRoot, p.projectId, p.squadId).integration;
    const sha = await this.d.git.headSha(integration.path);
    if (!sha || !(await this.d.git.hasPath(integration.path, sha, p.path)))
      throw new SquadWorkspaceError(
        "missing-contract",
        `The contract "${p.path}" isn't on the integration branch yet`,
      );
    this.d.ingest.execute([
      squadEvent(
        "contract.frozen",
        {
          key: keys.contractFrozen(p.squadId, p.path, p.version),
          ts: this.d.clock.iso(),
          projectId: p.projectId,
        },
        { squadId: p.squadId, path: p.path, version: p.version, sha },
      ),
    ]);
    return { sha };
  }
}
