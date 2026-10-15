import type { ReleaseInfo } from "../../domain/release-version";

/** Where Gravita's published releases are listed (GitHub). */
export interface ReleaseSource {
  /** The recent releases, newest first or not; rejects when they can't be read. */
  list(): Promise<ReleaseInfo[]>;
}
