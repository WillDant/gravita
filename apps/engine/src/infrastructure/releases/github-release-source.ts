import type { ReleaseSource } from "../../application/ports/release-source";
import type { ReleaseAsset, ReleaseInfo } from "../../domain/release-version";

/** Gravita's repository; its releases are public, so no credential is needed or sent. */
export const RELEASES_REPO = "WillDant/gravita";
const TIMEOUT_MS = 10_000;

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

interface GithubRelease {
  tag_name?: unknown;
  html_url?: unknown;
  draft?: unknown;
  assets?: unknown;
}

interface GithubAsset {
  name?: unknown;
  browser_download_url?: unknown;
  size?: unknown;
  digest?: unknown;
}

/** The Apple-silicon installer among a release's files, if it has a SHA-256 digest. */
function installerOf(assets: unknown, repo: string): ReleaseAsset | undefined {
  if (!Array.isArray(assets)) return undefined;
  for (const a of assets as GithubAsset[]) {
    if (typeof a.name !== "string" || !/^Gravita_[\w.-]+_aarch64\.dmg$/.test(a.name)) continue;
    if (typeof a.browser_download_url !== "string" || typeof a.size !== "number") continue;
    if (!a.browser_download_url.startsWith(`https://github.com/${repo}/releases/download/`))
      continue;
    const m = typeof a.digest === "string" ? /^sha256:([0-9a-f]{64})$/i.exec(a.digest) : null;
    if (!m) continue;
    return {
      name: a.name,
      url: a.browser_download_url,
      size: a.size,
      sha256: (m[1] as string).toLowerCase(),
    };
  }
  return undefined;
}

/**
 * The releases list of the repository, read through GitHub's public API with one anonymous
 * request (it names this app and its version, nothing about the user). `releases/latest`
 * would skip pre-releases, and every Gravita release is one so far, hence the list.
 */
export class GithubReleaseSource implements ReleaseSource {
  constructor(
    private readonly version: string,
    private readonly fetchFn: Fetch = (url, init) => fetch(url, init),
    private readonly repo = RELEASES_REPO,
  ) {}

  async list(): Promise<ReleaseInfo[]> {
    const res = await this.fetchFn(
      `https://api.github.com/repos/${this.repo}/releases?per_page=20`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": `gravita/${this.version}`,
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const body: unknown = await res.json();
    if (!Array.isArray(body)) throw new Error("GitHub's answer isn't a list");
    const releases: ReleaseInfo[] = [];
    for (const r of body as GithubRelease[]) {
      if (typeof r.tag_name !== "string" || typeof r.html_url !== "string") continue;
      // Only links back to the repository's own releases are ever handed on.
      if (!r.html_url.startsWith(`https://github.com/${this.repo}/releases/`)) continue;
      const asset = installerOf(r.assets, this.repo);
      releases.push({
        tag: r.tag_name,
        url: r.html_url,
        draft: r.draft === true,
        ...(asset ? { asset } : {}),
      });
    }
    return releases;
  }
}
