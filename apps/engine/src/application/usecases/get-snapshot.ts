import type { EngineFeed } from "../ports/event-publisher";
import type { ProjectionService, Snapshot } from "../services/projection-service";

/**
 * The full state for a client that is about to subscribe. Pending batches go out first,
 * so the snapshot and the batches after it never overlap.
 */
export class GetSnapshot {
  constructor(
    private readonly feed: EngineFeed,
    private readonly projection: ProjectionService,
  ) {}

  execute(): Snapshot {
    this.feed.flush();
    return this.projection.snapshot();
  }
}
