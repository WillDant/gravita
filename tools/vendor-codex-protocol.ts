// Vendors the Codex app-server protocol types Gravita uses. The app-server protocol is
// labelled experimental and changes between releases, so Gravita pins the types of the
// Codex release it was tested with instead of following whatever is installed.
//
//   bun tools/vendor-codex-protocol.ts            # generates with the installed `codex`
//   bun tools/vendor-codex-protocol.ts --from DIR # uses an existing generate-ts output
//
// It runs `codex app-server generate-ts --experimental` (Gravita opts into the
// experimental API: raw response items and request_user_input), keeps only the closure of
// the types listed in ROOTS, and writes them, with a header, under
// packages/adapter-codex/src/app-server/protocol/. Nothing else of Codex is touched.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize, relative } from "node:path";

/** The types Gravita speaks, relative to the generated root, without ".ts". */
const ROOTS = [
  "RequestId",
  "InitializeParams",
  "InitializeResponse",
  "v2/ThreadStartParams",
  "v2/ThreadStartResponse",
  "v2/ThreadResumeParams",
  "v2/ThreadResumeResponse",
  "v2/TurnStartParams",
  "v2/TurnStartResponse",
  "v2/TurnSteerParams",
  "v2/TurnSteerResponse",
  "v2/TurnInterruptParams",
  "v2/TurnInterruptResponse",
  "v2/ModelListParams",
  "v2/ModelListResponse",
  "v2/GetAccountParams",
  "v2/GetAccountResponse",
  "v2/GetAccountRateLimitsParams",
  "v2/GetAccountRateLimitsResponse",
  "v2/AccountUpdatedNotification",
  "v2/AccountRateLimitsUpdatedNotification",
  "v2/ThreadStartedNotification",
  "v2/ThreadStatusChangedNotification",
  "v2/TurnStartedNotification",
  "v2/TurnCompletedNotification",
  "v2/ItemStartedNotification",
  "v2/ItemCompletedNotification",
  "v2/AgentMessageDeltaNotification",
  "v2/ThreadTokenUsageUpdatedNotification",
  "v2/ErrorNotification",
  "v2/ServerRequestResolvedNotification",
  "v2/RawResponseItemCompletedNotification",
  "v2/CommandExecutionRequestApprovalParams",
  "v2/CommandExecutionRequestApprovalResponse",
  "v2/FileChangeRequestApprovalParams",
  "v2/FileChangeRequestApprovalResponse",
  "v2/PermissionsRequestApprovalParams",
  "v2/PermissionsRequestApprovalResponse",
  "v2/ToolRequestUserInputParams",
  "v2/ToolRequestUserInputResponse",
  "v2/McpServerElicitationRequestResponse",
  // Shapes the code above names on their own.
  "ResponseItem",
  "v2/AskForApproval",
  "v2/SandboxMode",
  "v2/SandboxPolicy",
  "v2/Thread",
  "v2/ThreadItem",
  "v2/Turn",
  "v2/TurnError",
  "v2/UserInput",
  "v2/RateLimitSnapshot",
  "v2/Model",
  "v2/Account",
  "v2/TokenUsageBreakdown",
];

const repo = join(import.meta.dir, "..");
const out = join(repo, "packages/adapter-codex/src/app-server/protocol");

function codexVersion(): string {
  const r = spawnSync("codex", ["--version"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("`codex --version` failed; is Codex installed?");
  return r.stdout.trim();
}

function generate(): string {
  const dir = mkdtempSync(join(tmpdir(), "codex-protocol-"));
  const r = spawnSync("codex", ["app-server", "generate-ts", "--experimental", "--out", dir], {
    stdio: "inherit",
  });
  if (r.status !== 0) throw new Error("`codex app-server generate-ts` failed");
  return dir;
}

const fromIdx = process.argv.indexOf("--from");
const from = fromIdx >= 0 ? process.argv[fromIdx + 1]! : generate();
const version = codexVersion();

/** Every type file a root needs, following relative `import type` lines. */
const keep = new Set<string>();
const queue = [...ROOTS];
while (queue.length) {
  const rel = normalize(queue.pop()!);
  if (keep.has(rel)) continue;
  const file = join(from, `${rel}.ts`);
  if (!existsSync(file)) throw new Error(`missing generated type ${rel}`);
  keep.add(rel);
  for (const m of readFileSync(file, "utf8").matchAll(/from "(\.{1,2}\/[^"]+)"/g))
    queue.push(relative(from, join(dirname(file), m[1]!)));
}

const header = (rel: string) =>
  [
    `// Vendored from ${version}: \`codex app-server generate-ts --experimental\`, reduced by`,
    "// tools/vendor-codex-protocol.ts to the types Gravita uses. Do not edit by hand:",
    `// regenerate with \`bun tools/vendor-codex-protocol.ts\` when moving to another Codex. (${rel}.ts)`,
    "",
  ].join("\n");

rmSync(out, { recursive: true, force: true });
for (const rel of [...keep].sort()) {
  const target = join(out, `${rel}.ts`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, header(rel) + readFileSync(join(from, `${rel}.ts`), "utf8"));
}
const index = [
  header("index"),
  ...ROOTS.map((r) => `export type { ${r.split("/").pop()} } from "./${r}";`),
  "",
].join("\n");
writeFileSync(join(out, "index.ts"), index);
console.log(`vendored ${keep.size} types from ${version} into ${relative(repo, out)}`);
