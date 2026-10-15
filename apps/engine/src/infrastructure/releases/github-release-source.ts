import type { ReleaseSource } from "../../application/ports/release-source";
import type { ReleaseInfo } from "../../domain/release-version";

/** Gravita's repository; its releases are public, so no credential is needed or sent. */
export const RELEASES_REPO = "WillDant/gravita";
const TIMEOUT_MS = 10_000;

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

interface GithubRelease {
  tag_name?: unknown;
  html_url?: unknown;
  draft?: unknown;
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
      releases.push({ tag: r.tag_name, url: r.html_url, draft: r.draft === true });
    }
    return releases;
  }
}
