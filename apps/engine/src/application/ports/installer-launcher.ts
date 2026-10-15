import type { ReleaseAsset } from "../../domain/release-version";

/** Gets a release's installer onto this computer and puts it in front of the user. */
export interface InstallerLauncher {
  /** Downloads the installer, checks it against the asset's size and SHA-256, then opens it. */
  install(asset: ReleaseAsset): Promise<void>;
}
