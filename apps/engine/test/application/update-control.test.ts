import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InstallerLauncher } from "../../src/application/ports/installer-launcher";
import { ReleaseChecker } from "../../src/application/services/release-checker";
import { UpdateControl } from "../../src/application/services/update-control";
import { UpdateUnavailableError } from "../../src/domain/errors";
import type { ReleaseAsset, ReleaseInfo } from "../../src/domain/release-version";
import { DmgInstaller } from "../../src/infrastructure/releases/dmg-installer";
import { GithubReleaseSource } from "../../src/infrastructure/releases/github-release-source";
import { FakeClock, SilentLogger } from "../fakes";

const BYTES = new TextEncoder().encode("pretend this is a disk image");
const SHA = createHash("sha256").update(BYTES).digest("hex");
const BASE = "https://github.com/WillDant/gravita/releases";

const asset = (over: Partial<ReleaseAsset> = {}): ReleaseAsset => ({
  name: "Gravita_0.8.0-beta_aarch64.dmg",
  url: `${BASE}/download/v0.8.0-beta/Gravita_0.8.0-beta_aarch64.dmg`,
  size: BYTES.byteLength,
  sha256: SHA,
  ...over,
});

const release = (withAsset: boolean): ReleaseInfo => ({
  tag: "v0.8.0-beta",
  url: `${BASE}/tag/v0.8.0-beta`,
  draft: false,
  ...(withAsset ? { asset: asset() } : {}),
});

function control(list: ReleaseInfo[], launcher: InstallerLauncher) {
  const seen: unknown[] = [];
  const checker = new ReleaseChecker({
    source: { list: async () => list },
    status: { updateStatus: (p) => seen.push(p.update) },
    clock: new FakeClock(),
    logger: new SilentLogger(),
    current: "0.7.0-beta",
  });
  return { updates: new UpdateControl(checker, launcher), seen };
}

describe("UpdateControl", () => {
  test("check reports the update without the installer's link", async () => {
    const { updates, seen } = control([release(true)], { install: async () => {} });
    const { update } = await updates.check();
    expect(update?.version).toBe("0.8.0-beta");
    expect(update?.asset).toEqual({
      name: "Gravita_0.8.0-beta_aarch64.dmg",
      size: BYTES.byteLength,
      sha256: SHA,
    });
    expect(JSON.stringify(seen)).not.toContain("download");
  });

  test("check rejects when the releases can't be read", async () => {
    const checker = new ReleaseChecker({
      source: {
        list: async () => {
          throw new Error("offline");
        },
      },
      status: { updateStatus: () => {} },
      clock: new FakeClock(),
      logger: new SilentLogger(),
      current: "0.7.0-beta",
    });
    const updates = new UpdateControl(checker, { install: async () => {} });
    await expect(updates.check()).rejects.toThrow("offline");
  });

  test("install hands the found asset to the launcher, once for two clicks", async () => {
    const got: ReleaseAsset[] = [];
    let release_!: () => void;
    const gate = new Promise<void>((r) => {
      release_ = r;
    });
    const { updates } = control([release(true)], {
      install: async (a) => {
        got.push(a);
        await gate;
      },
    });
    await updates.check();
    const a = updates.install();
    const b = updates.install();
    release_();
    await Promise.all([a, b]);
    expect(got).toEqual([asset()]);
  });

  test("install refuses when nothing was found or the release has no installer", async () => {
    const none = control([release(false)], { install: async () => {} });
    expect(() => none.updates.install()).toThrow(UpdateUnavailableError);
    await none.updates.check();
    expect(() => none.updates.install()).toThrow(UpdateUnavailableError);
  });
});

describe("GithubReleaseSource assets", () => {
  const gh = (assets: unknown[]) =>
    new GithubReleaseSource(
      "0.7.0-beta",
      async () =>
        new Response(
          JSON.stringify([
            { tag_name: "v0.8.0-beta", html_url: `${BASE}/tag/v0.8.0-beta`, assets },
          ]),
        ),
    );
  const dmg = (over: Record<string, unknown> = {}) => ({
    name: "Gravita_0.8.0-beta_aarch64.dmg",
    browser_download_url: `${BASE}/download/v0.8.0-beta/Gravita_0.8.0-beta_aarch64.dmg`,
    size: 10,
    digest: `sha256:${SHA.toUpperCase()}`,
    ...over,
  });

  test("takes the aarch64 dmg with its digest, lowercased", async () => {
    const [r] = await gh([{ name: "other.zip" }, dmg()]).list();
    expect(r?.asset).toEqual({
      name: "Gravita_0.8.0-beta_aarch64.dmg",
      url: `${BASE}/download/v0.8.0-beta/Gravita_0.8.0-beta_aarch64.dmg`,
      size: 10,
      sha256: SHA,
    });
  });

  test("skips an installer without a digest, off-repo, or oddly named", async () => {
    for (const bad of [
      dmg({ digest: undefined }),
      dmg({ browser_download_url: "https://evil.example/x.dmg" }),
      dmg({ name: "../Gravita_x_aarch64.dmg" }),
    ]) {
      const [r] = await gh([bad]).list();
      expect(r?.asset).toBeUndefined();
    }
  });
});

describe("DmgInstaller", () => {
  const setup = async (res: () => Response, platform: NodeJS.Platform = "darwin") => {
    const tmp = await mkdtemp(join(tmpdir(), "gravita-test-"));
    const opened: string[] = [];
    const installer = new DmgInstaller(
      "0.7.0-beta",
      platform,
      async () => res(),
      async (p) => {
        opened.push(p);
      },
      tmp,
    );
    return { installer, tmp, opened };
  };

  test("downloads, verifies and opens the file", async () => {
    const { installer, opened } = await setup(() => new Response(BYTES));
    await installer.install(asset());
    expect(opened).toHaveLength(1);
    expect(opened[0]).toEndWith("Gravita_0.8.0-beta_aarch64.dmg");
    expect(new Uint8Array(await readFile(opened[0] as string))).toEqual(BYTES);
  });

  test("a file that doesn't match is never written or opened", async () => {
    const { installer, tmp, opened } = await setup(() => new Response(new Uint8Array([1, 2, 3])));
    await expect(installer.install(asset())).rejects.toThrow("doesn't match");
    expect(opened).toEqual([]);
    expect(await readdir(tmp)).toEqual([]);
    const wrongHash = await setup(() => new Response(BYTES));
    await expect(wrongHash.installer.install(asset({ sha256: "0".repeat(64) }))).rejects.toThrow(
      "doesn't match",
    );
  });

  test("a failed download and a non-mac platform are refused", async () => {
    const bad = await setup(() => new Response("no", { status: 404 }));
    await expect(bad.installer.install(asset())).rejects.toThrow("404");
    const linux = await setup(() => new Response(BYTES), "linux");
    await expect(linux.installer.install(asset())).rejects.toThrow("macOS only");
  });
});
