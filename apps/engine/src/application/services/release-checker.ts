import { type AvailableUpdate, newerRelease } from "../../domain/release-version";
import type { Clock } from "../ports/clock";
import type { Logger } from "../ports/logger";
import type { ReleaseSource } from "../ports/release-source";

/** What the UI is told: the installer's link stays in the engine. */
export type PublicUpdate = Omit<AvailableUpdate, "asset"> & {
  asset?: { name: string; size: number; sha256: string };
};

export function publicView(u: AvailableUpdate): PublicUpdate {
  const { asset, ...rest } = u;
  return asset
    ? { ...rest, asset: { name: asset.name, size: asset.size, sha256: asset.sha256 } }
    : rest;
}

export interface ReleaseCheckerOptions {
  source: ReleaseSource;
  /** Where the result goes: the engine status the UI reads. */
  status: {
    updateStatus(patch: { update: PublicUpdate | undefined }): void;
  };
  clock: Clock;
  logger: Logger;
  /** The version this engine (and the app it ships in) is. */
  current: string;
  /** Wait before the first look, so start-up stays quiet. */
  firstDelayMs?: number;
  intervalMs?: number;
}

const FIRST_DELAY_MS = 15_000;
const INTERVAL_MS = 6 * 3_600_000;

/**
 * Tells the app when a release newer than the one running is published: it looks soon after
 * start-up and every few hours, and puts what it finds in the engine status. Never throws:
 * offline, rate-limited or an odd answer just leaves the last result as it was.
 */
export class ReleaseChecker {
  private cancel: (() => void) | undefined;
  private stopped = false;
  private found: AvailableUpdate | undefined;

  constructor(private readonly o: ReleaseCheckerOptions) {}

  start() {
    this.schedule(this.o.firstDelayMs ?? FIRST_DELAY_MS);
  }

  stop() {
    this.stopped = true;
    this.cancel?.();
  }

  /** The update the last look found, with its installer link (which never leaves the engine). */
  get latest(): AvailableUpdate | undefined {
    return this.found;
  }

  /** One look; resolves once the status is up to date. Rejects only when `strict`. */
  async check({ strict = false }: { strict?: boolean } = {}): Promise<void> {
    try {
      const releases = await this.o.source.list();
      this.found = newerRelease(releases, this.o.current);
      this.o.status.updateStatus({ update: this.found && publicView(this.found) });
    } catch (err) {
      this.o.logger.log("release check failed", err);
      if (strict) throw err;
    }
  }

  private schedule(ms: number) {
    if (this.stopped) return;
    this.cancel = this.o.clock.setTimer(() => {
      void this.check().finally(() => this.schedule(this.o.intervalMs ?? INTERVAL_MS));
    }, ms);
  }
}
