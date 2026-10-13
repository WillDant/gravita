import { type ProjectIdentity, projectDiscoveredEvent } from "@gravita/protocol";
import type { Clock } from "../ports/clock";
import type { ProjectDirectory } from "../ports/project-directory";
import type { IngestEvents } from "./ingest-events";

/** Resolves a cwd to its project and announces each project once per engine run. */
export class AnnounceProject {
  private readonly announced = new Set<string>();

  constructor(
    private readonly projects: ProjectDirectory,
    private readonly ingest: IngestEvents,
    private readonly clock: Clock,
  ) {}

  async execute(cwd: string, ts: string): Promise<ProjectIdentity> {
    const p = await this.projects.resolve(cwd);
    if (!this.announced.has(p.id)) {
      this.announced.add(p.id);
      this.ingest.execute([
        projectDiscoveredEvent(p, ts || this.clock.iso(), {
          source: "gravita",
          provider: "claude",
        }),
      ]);
    }
    return p;
  }
}
