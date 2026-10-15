// Comparing Gravita's release versions: `MAJOR.MINOR.PATCH` with an optional label
// (`0.5.0-beta`), as the release tags name them (`v0.5.0-beta`).

export interface ParsedVersion {
  numbers: [number, number, number];
  /** Dot-separated label parts (`beta`, `rc.1`); empty for a final release. */
  label: string[];
}

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(text: string): ParsedVersion | undefined {
  const m = VERSION.exec(text.trim());
  if (!m) return undefined;
  return {
    numbers: [Number(m[1]), Number(m[2]), Number(m[3])],
    label: m[4] ? m[4].split(".") : [],
  };
}

const isNumeric = (s: string) => /^\d+$/.test(s);

/** Negative when `a` is older than `b`, positive when newer, 0 when the same. */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  for (let i = 0; i < 3; i++) {
    const d = (a.numbers[i] as number) - (b.numbers[i] as number);
    if (d !== 0) return d;
  }
  // A final release comes after any of its labelled ones (`0.5.0` after `0.5.0-beta`).
  if (a.label.length === 0 || b.label.length === 0) return b.label.length - a.label.length;
  for (let i = 0; i < Math.max(a.label.length, b.label.length); i++) {
    const x = a.label[i];
    const y = b.label[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (isNumeric(x) && isNumeric(y)) return Number(x) - Number(y);
    // A number comes before a word; words go in alphabetical order (alpha < beta < rc).
    if (isNumeric(x)) return -1;
    if (isNumeric(y)) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** The installer a release ships: what to download and how to check what came down. */
export interface ReleaseAsset {
  name: string;
  /** Its download link (under the repository's own releases). */
  url: string;
  size: number;
  /** Lowercase hex SHA-256, from GitHub's own digest of the uploaded file. */
  sha256: string;
}

export interface ReleaseInfo {
  /** The release's tag (`v0.5.0-beta`). */
  tag: string;
  /** Its page. */
  url: string;
  draft: boolean;
  /** The macOS installer, when the release has one with a digest. */
  asset?: ReleaseAsset;
}

export interface AvailableUpdate {
  version: string;
  url: string;
  asset?: ReleaseAsset;
}

/** The newest published release that is newer than `current`, if there is one. */
export function newerRelease(
  releases: readonly ReleaseInfo[],
  current: string,
): AvailableUpdate | undefined {
  const now = parseVersion(current);
  if (!now) return undefined;
  let best: { parsed: ParsedVersion; release: ReleaseInfo } | undefined;
  for (const release of releases) {
    if (release.draft) continue;
    const parsed = parseVersion(release.tag);
    if (!parsed || compareVersions(parsed, now) <= 0) continue;
    if (!best || compareVersions(parsed, best.parsed) > 0) best = { parsed, release };
  }
  if (!best) return undefined;
  const { release } = best;
  return {
    version: release.tag.replace(/^v/, ""),
    url: release.url,
    ...(release.asset ? { asset: release.asset } : {}),
  };
}
