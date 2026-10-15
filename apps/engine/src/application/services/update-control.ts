import { UpdateUnavailableError } from "../../domain/errors";
import type { InstallerLauncher } from "../ports/installer-launcher";
import { type PublicUpdate, publicView, type ReleaseChecker } from "./release-checker";

/**
 * What the UI asks about updates: look for one now, and install the one the engine found.
 * The installer to fetch is always the one the last look found, never a link a client gives.
 */
export class UpdateControl {
  private installing: Promise<void> | undefined;

  constructor(
    private readonly checker: ReleaseChecker,
    private readonly launcher: InstallerLauncher,
  ) {}

  async check(): Promise<{ update: PublicUpdate | undefined }> {
    await this.checker.check({ strict: true });
    const found = this.checker.latest;
    return { update: found && publicView(found) };
  }

  install(): Promise<void> {
    const asset = this.checker.latest?.asset;
    if (!asset) {
      throw new UpdateUnavailableError("There is no installer to download for this release.");
    }
    // A second click while one download runs joins it instead of starting another.
    this.installing ??= this.launcher.install(asset).finally(() => {
      this.installing = undefined;
    });
    return this.installing;
  }
}
