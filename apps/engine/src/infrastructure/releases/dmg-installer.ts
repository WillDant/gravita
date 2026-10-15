import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InstallerLauncher } from "../../application/ports/installer-launcher";
import { UpdateUnavailableError } from "../../domain/errors";
import type { ReleaseAsset } from "../../domain/release-version";

const TIMEOUT_MS = 5 * 60_000;

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
type Open = (path: string) => Promise<void>;

const openWithMacOs: Open = (path) =>
  new Promise((resolve, reject) => {
    execFile("/usr/bin/open", [path], (err) => (err ? reject(err) : resolve()));
  });

/**
 * Downloads a release's .dmg into a private temporary folder, checks its size and SHA-256
 * against what GitHub reported, and opens it with macOS so the user can drag Gravita to
 * Applications. A file that doesn't match is deleted and never opened.
 */
export class DmgInstaller implements InstallerLauncher {
  constructor(
    private readonly version: string,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly fetchFn: Fetch = (url, init) => fetch(url, init),
    private readonly open: Open = openWithMacOs,
    private readonly tmp: string = tmpdir(),
  ) {}

  async install(asset: ReleaseAsset): Promise<void> {
    if (this.platform !== "darwin") {
      throw new UpdateUnavailableError("Installing from Gravita works on macOS only.");
    }
    const res = await this.fetchFn(asset.url, {
      headers: { "User-Agent": `gravita/${this.version}` },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new UpdateUnavailableError(`The download failed (${res.status}).`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const sha = createHash("sha256").update(bytes).digest("hex");
    if (bytes.byteLength !== asset.size || sha !== asset.sha256) {
      throw new UpdateUnavailableError(
        "The downloaded file doesn't match the release; it was discarded.",
      );
    }
    // The folder is owner-only (mkdtemp makes it 0700) and the name is fixed by us.
    const dir = await mkdtemp(join(this.tmp, "gravita-update-"));
    const file = join(dir, asset.name);
    try {
      await writeFile(file, bytes, { mode: 0o600 });
      await this.open(file);
    } catch (err) {
      await rm(dir, { recursive: true, force: true });
      throw err;
    }
  }
}
