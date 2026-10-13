import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SquadPlan } from "@gravita/protocol";
import { ProjectionService } from "../src/application/services/projection-service";
import { IngestEvents } from "../src/application/usecases/ingest-events";
import { CliGitWorkspace } from "../src/infrastructure/git/cli-git-workspace";
import { GitRunner } from "../src/infrastructure/git/git-runner";
import { createSquadToolkit, type SquadOptions } from "../src/main/container";
import { FakeClock, MemoryEventStore, RecordingPublisher } from "./fakes";

// Real git in temp dirs, isolated from the developer's git config: HOME is the temp dir and
// neither the global nor the system config is read (CI and laptops behave the same).

export function isolatedEnv(home: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: home,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
  };
}

/** Runs git as "the user" (seeding fixtures); throws on failure. */
export async function sh(cwd: string, env: Record<string, string>, ...args: string[]) {
  const proc = Bun.spawn(
    ["git", "-c", "user.name=Test User", "-c", "user.email=user@example.com", ...args],
    { cwd, env, stdout: "pipe", stderr: "pipe", stdin: "ignore" },
  );
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if ((await proc.exited) !== 0) throw new Error(`git ${args.join(" ")}: ${err}`);
  return out.trim();
}

export async function writeFiles(dir: string, files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), text);
  }
}

/** A repository on `main` with one commit of `files`. */
export async function userRepo(
  dir: string,
  env: Record<string, string>,
  files: Record<string, string>,
) {
  await mkdir(dir, { recursive: true });
  await sh(dir, env, "init", "-q", "-b", "main");
  await writeFiles(dir, files);
  await sh(dir, env, "add", "-A");
  await sh(dir, env, "commit", "-q", "-m", "initial");
}

export const BASE_FILES = {
  "README.md": "# demo\n",
  "package.json": '{ "name": "demo" }\n',
  "pnpm-lock.yaml": "lockfileVersion: 9\n",
  "apps/api/index.ts": "export const api = 1;\n",
  "apps/web/index.ts": "export const web = 1;\n",
};

export function testPlan(over: Partial<SquadPlan> = {}): SquadPlan {
  return {
    goal: "Build the demo",
    summary: "An API and a web app.",
    stack: ["typescript"],
    roles: [
      { id: "planner", name: "Planner", kind: "planner", owns: ["docs/"], charter: "" },
      { id: "backend", name: "Backend", kind: "backend", owns: ["apps/api/"], charter: "" },
      { id: "frontend", name: "Frontend", kind: "frontend", owns: ["apps/web/"], charter: "" },
    ],
    shared: { paths: ["pnpm-lock.yaml", "package.json"], strategy: "regenerate" },
    contracts: [],
    tasks: [
      {
        id: "api-1",
        role: "backend",
        title: "Add the API",
        plainSummary: "The server.",
        dependsOn: [],
        writes: ["apps/api/"],
        acceptance: ["it answers"],
        size: "s",
      },
      {
        id: "web-1",
        role: "frontend",
        title: "Add the page",
        plainSummary: "The page.",
        dependsOn: [],
        writes: ["apps/web/"],
        acceptance: ["it shows"],
        size: "s",
      },
    ],
    checks: [],
    assumptions: [],
    questions: [],
    ...over,
  };
}

/** Real adapters over a temp dir, events into an in-memory store. */
export function squadHarness(tmp: string, over: Partial<SquadOptions> = {}) {
  const home = join(tmp, "home");
  const env = isolatedEnv(home);
  const store = new MemoryEventStore();
  const ingest = new IngestEvents(store, new ProjectionService(), new RecordingPublisher());
  const clock = new FakeClock();
  const worktreesRoot = join(tmp, "data", "worktrees");
  const kit = createSquadToolkit(
    { worktreesRoot, env, checkEnv: () => env, ...over },
    { ingest, clock },
  );
  const git = new CliGitWorkspace(new GitRunner({ env }));
  return { home, env, store, ingest, clock, worktreesRoot, kit, git };
}

export const eventsOf = (store: MemoryEventStore, type?: string) =>
  store.rows.filter((e) => !type || e.type === type);
