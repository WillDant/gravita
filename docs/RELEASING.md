# Releasing Gravita

How a release is made, by hand, from a Mac with Apple silicon. A release is a tag `vX.Y.Z-beta` on `main`, a GitHub pre-release with the `.dmg`, and the files the in-app updater reads. Every release so far is a pre-release.

## What you need once

- **Tools:** Rust (`rustc`), Bun, pnpm, Node 22.22 or later, and the GitHub CLI logged in (`gh auth status`) with write access to `WillDant/gravita`.
- **The updater signing key.** The app only installs update packages signed with Gravita's key (its public half is `plugins.updater.pubkey` in `apps/desktop/src-tauri/tauri.conf.json`). Put the private key at `~/.tauri/gravita.key` (`chmod 600 ~/.tauri/gravita.key`) and keep its password in your password manager.
  - Never commit the key or the password, and never paste them in an issue, a PR or a chat.
  - **Do not generate a new key.** Apps already installed trust the old one only; a package signed with another key is refused and those installs can no longer update themselves (they would have to download the `.dmg` again).
  - Losing the key has the same effect, so keep a backup.
- The build asks for the key through two environment variables. Set them in the terminal you build from, not in a file in the repo:

  ```sh
  export TAURI_SIGNING_PRIVATE_KEY="$HOME/.tauri/gravita.key"
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD='the password'
  ```

## Before you start

1. Everything that goes in the release is merged into `main`, and CI is green.
2. Eject any mounted Gravita disk image (`/Volumes/Gravita`): a mounted one makes the `.dmg` build fail.
3. Pick the version, `X.Y.Z-beta` (below, `NEW`; `OLD` is the current one, see `version` in `apps/desktop/src-tauri/tauri.conf.json`).

## 1. Bump the version

On an up-to-date `main`:

```sh
git checkout main && git pull --ff-only
OLD=0.8.2-beta; NEW=0.8.3-beta     # set both

# package.json (apps and packages), the Deep Observe plugin and tauri.conf.json
sed -i '' "s/\"version\": \"$OLD\"/\"version\": \"$NEW\"/" \
  $(git ls-files | grep -E 'package.json$|plugin.json$|tauri.conf.json$' | xargs grep -l "\"version\": \"$OLD\"")
# the desktop crate and its lock entry
sed -i '' "3s/$OLD/$NEW/" apps/desktop/src-tauri/Cargo.toml
sed -i '' "/^name = \"gravita\"$/{n;s/version = \"$OLD\"/version = \"$NEW\"/;}" apps/desktop/src-tauri/Cargo.lock
# the status line in the README and in the AI context
sed -i '' "s/\*\*v$OLD\*\*/**v$NEW**/" README.md .ai/CONTEXT.md

git diff --stat      # expect 15 files, one line each
grep -rn "$OLD" README.md .ai/CONTEXT.md apps/desktop/src-tauri/Cargo.* apps/*/package.json   # expect nothing
```

Then edit by hand:

- **`CHANGELOG.md`:** a new `## [NEW] - YYYY-MM-DD` section above the previous one (a one-line summary, then `### Interface`, `### Updates`, `### Known limits` as needed), and a link line `[NEW]: https://github.com/WillDant/gravita/releases/tag/vNEW` at the bottom, above the previous version's.
- **`docs/ROADMAP.md`:** a `### Title — [vNEW](…)` entry with one or two sentences, above `## Next`.

Commit and tag, straight on `main` (as the earlier releases were):

```sh
git add -A
git commit -m "chore(release): vNEW"
git tag vNEW
git push origin main vNEW
```

## 2. Build, signed

```sh
bun tools/build-sidecar.ts          # recompiles the engine, which carries the version number
rm -rf apps/desktop/src-tauri/target/release/bundle
cd apps/desktop
pnpm tauri build --bundles dmg,app  # needs the two TAURI_SIGNING_* variables
```

Check what came out, in `apps/desktop/src-tauri/target/release/bundle/`:

- `dmg/Gravita_NEW_aarch64.dmg`
- `macos/Gravita.app.tar.gz` and `macos/Gravita.app.tar.gz.sig` (the update package and its signature)
- `/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" macos/Gravita.app/Contents/Info.plist` prints `NEW`. If it prints the old version, you built before bumping: go back to step 1.

Get the DMG's checksum for the notes: `shasum -a 256 dmg/Gravita_NEW_aarch64.dmg`.

## 3. Publish

Write the release notes in a file (for example `/tmp/notes.md`), the same text as the CHANGELOG section followed by the install steps. Copy the previous release's notes (`gh release view vOLD --json body -q .body`) and change the version numbers and the checksum.

```sh
# from the repository root
gh release create vNEW apps/desktop/src-tauri/target/release/bundle/dmg/Gravita_NEW_aarch64.dmg \
  --title "vNEW" --notes-file /tmp/notes.md --prerelease --verify-tag

bun tools/publish-updater.ts /tmp/notes.md
```

`tools/publish-updater.ts` attaches the update package to the release and rewrites `latest.json` on the release tagged `updater`: the one fixed address installed apps ask (`releases/latest` can't be used because it skips pre-releases). The `updater` release is not a Gravita version; leave it alone.

## 4. Check it

```sh
curl -sL https://github.com/WillDant/gravita/releases/download/updater/latest.json
```

It must show `NEW` and a `url` ending in `Gravita_NEW_aarch64.app.tar.gz`. Then, with the **previous** version installed, open Settings → Updates → "Check for updates" → "Install": the app should download, replace itself and open again on `NEW`. That is the only real test of the updater; do it for every release.

## Things that go wrong

- **`.dmg` build fails with `bundle_dmg.sh`:** a Gravita disk image is mounted; eject it (and any `rw.*.dmg` in `bundle/macos/`) and build again.
- **Build says there is no signing key:** the two `TAURI_SIGNING_*` variables aren't set in this terminal.
- **The app says it is on the old version after an update, or Settings shows the wrong version:** the sidecar wasn't rebuilt (`bun tools/build-sidecar.ts`) before the build.
- **CI fails on `pnpm install --frozen-lockfile`:** a dependency changed in a `package.json` without `pnpm install` updating `pnpm-lock.yaml`; run `pnpm install` and commit the lockfile.
- **A wrong release is out:** if nobody has installed it, `gh release delete vNEW --cleanup-tag`, fix, and publish again. Publishing again overwrites `latest.json`. If people could already have it, publish a new patch version instead.
- **Installed apps ask for the Keychain after an update:** expected for now. Builds are signed ad hoc, so macOS treats each version as a new app until Gravita is notarized (needs an Apple Developer account).
