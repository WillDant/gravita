// Compiles the engine into a single binary named the way Tauri's externalBin expects:
// apps/desktop/src-tauri/binaries/gravita-engine-<rust target triple>[.exe]

import { join } from "node:path";
import { $ } from "bun";

const root = join(import.meta.dir, "..");
const triple = (await $`rustc -vV`.text()).match(/host: (\S+)/)?.[1];
if (!triple) throw new Error("rustc not found: install Rust to build the desktop app");

const bunTarget: Record<string, string> = {
  "aarch64-apple-darwin": "bun-darwin-arm64",
  "x86_64-apple-darwin": "bun-darwin-x64",
  "x86_64-pc-windows-msvc": "bun-windows-x64",
  "x86_64-unknown-linux-gnu": "bun-linux-x64",
  "aarch64-unknown-linux-gnu": "bun-linux-arm64",
};
const target = process.env.GRAVITA_BUN_TARGET ?? bunTarget[triple];
if (!target) throw new Error(`no Bun target for ${triple}`);

const ext = triple.includes("windows") ? ".exe" : "";
const out = join(root, "apps/desktop/src-tauri/binaries", `gravita-engine-${triple}${ext}`);
// The Agent SDK's per-platform Claude binaries are never bundled: Gravita runs the user's own claude.
await $`bun build --compile --minify --target=${target} ${join(root, "apps/engine/src/main.ts")} --outfile ${out} --external ${"@anthropic-ai/claude-agent-sdk-*"}`;
const size = (await Bun.file(out).size) / 1024 / 1024;
console.log(`sidecar → ${out} (${size.toFixed(1)} MB)`);
