// After `tauri build` (with TAURI_SIGNING_PRIVATE_KEY set), publishes what the app's updater
// needs for a release that already exists on GitHub:
//   1. the signed update package, attached to that release;
//   2. `latest.json`, attached to the fixed release tagged `updater`: the one address the app
//      asks (see `plugins.updater.endpoints` in tauri.conf.json). Releases/latest can't be
//      used, because it skips pre-releases and every Gravita release is one so far.
// Usage: bun tools/publish-updater.ts [notes-file]

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

const root = join(import.meta.dir, "..");
const conf = JSON.parse(
  await readFile(join(root, "apps/desktop/src-tauri/tauri.conf.json"), "utf8"),
);
const version: string = conf.version;
const tag = `v${version}`;
const repo = "WillDant/gravita";
const macos = join(root, "apps/desktop/src-tauri/target/release/bundle/macos");
const triple = (await $`rustc -vV`.text()).match(/host: (\S+)/)?.[1];
const platform = triple?.startsWith("aarch64-apple-darwin")
  ? "darwin-aarch64"
  : triple?.startsWith("x86_64-apple-darwin")
    ? "darwin-x86_64"
    : undefined;
if (!platform) throw new Error(`No updater platform for ${triple}`);
const arch = platform.endsWith("aarch64") ? "aarch64" : "x64";

const archive = join(macos, "Gravita.app.tar.gz");
const signature = (await readFile(`${archive}.sig`, "utf8")).trim();
const asset = `Gravita_${version}_${arch}.app.tar.gz`;
const tmp = await mkdtemp(join(tmpdir(), "gravita-updater-"));
const upload = join(tmp, asset);
await Bun.write(upload, Bun.file(archive));
await $`gh release upload ${tag} ${upload} --repo ${repo} --clobber`;

const notesFile = process.argv[2];
const feed = {
  version,
  notes: notesFile ? (await readFile(notesFile, "utf8")).split("\n### Install")[0]?.trim() : "",
  pub_date: new Date().toISOString(),
  platforms: {
    [platform]: {
      signature,
      url: `https://github.com/${repo}/releases/download/${tag}/${asset}`,
    },
  },
};
const feedFile = join(tmp, "latest.json");
await writeFile(feedFile, `${JSON.stringify(feed, null, 2)}\n`);

// The feed release is created once; it is a pre-release so it never shows as "Latest".
const exists = await $`gh release view updater --repo ${repo}`.quiet().nothrow();
if (exists.exitCode !== 0) {
  await $`gh release create updater --repo ${repo} --prerelease --title ${"Updater feed"} --notes ${"Holds latest.json, which the app asks for updates. Not a release."} --target main`;
}
await $`gh release upload updater ${feedFile} --repo ${repo} --clobber`;
console.log(`published ${asset} and latest.json for ${tag}`);
