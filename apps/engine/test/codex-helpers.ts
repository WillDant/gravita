import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RolloutFs } from "@gravita/adapter-codex";
import type { Clock } from "../src/application/ports/clock";
import type { SessionOwnership } from "../src/application/ports/session-runtime";
import { AnnounceProject } from "../src/application/usecases/announce-project";
import { CodexPresence } from "../src/infrastructure/codex/codex-presence";
import {
  type CodexDiscoveryFs,
  CodexSessionDiscovery,
} from "../src/infrastructure/codex/codex-session-discovery";
import { CodexSessionSource } from "../src/infrastructure/codex/codex-session-source";
import { TailScheduler } from "../src/infrastructure/sessions/tail-scheduler";
import type { EngineCore } from "../src/main/container";

export const CODEX_FIXTURES = join(import.meta.dir, "../../../fixtures/codex/0.160");

const pad = (n: number) => String(n).padStart(2, "0");

/** `sessions/YYYY/MM/DD` of a local date, as Codex names its folders. */
export function dayDir(codexHome: string, ms: number): string {
  const d = new Date(ms);
  return join(
    codexHome,
    "sessions",
    String(d.getFullYear()),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
  );
}

/** A fixture's rollouts as `{name, bytes}`, oldest first. */
export async function fixtureRollouts(
  scenario: string,
): Promise<{ name: string; bytes: Buffer }[]> {
  const dir = join(CODEX_FIXTURES, scenario, "sessions", "2026", "10", "12");
  const names = (await readdir(dir)).filter((n) => n.endsWith(".jsonl")).sort();
  return Promise.all(names.map(async (name) => ({ name, bytes: await readFile(join(dir, name)) })));
}

/** Copies a fixture's rollouts into the date folder of `ms` under `codexHome`. */
export async function installFixture(codexHome: string, scenario: string, ms: number) {
  const dir = dayDir(codexHome, ms);
  await mkdir(dir, { recursive: true });
  for (const f of await fixtureRollouts(scenario)) await writeFile(join(dir, f.name), f.bytes);
  return dir;
}

export interface CodexTailsOptions {
  codexHome: string;
  core: EngineCore;
  clock?: Clock;
  ownership?: SessionOwnership;
  fs?: CodexDiscoveryFs;
  rolloutFs?: RolloutFs;
}

/** A tail scheduler with only the Codex source, on a core's stores. */
export function codexTails(o: CodexTailsOptions) {
  const clock = o.clock ?? o.core.clock;
  const discovery = new CodexSessionDiscovery({
    codexHome: o.codexHome,
    lookbackDays: 14,
    clock,
    ...(o.fs ? { fs: o.fs } : {}),
    ...(o.rolloutFs ? { rolloutFs: o.rolloutFs } : {}),
  });
  const presence = new CodexPresence({ ingest: o.core.ingest, clock });
  const tails = new TailScheduler({
    sources: [
      new CodexSessionSource({
        discovery,
        presence,
        clock,
        logger: o.core.logger,
        ...(o.rolloutFs ? { fs: o.rolloutFs } : {}),
      }),
    ],
    ingest: o.core.ingest,
    checkpoints: o.core.checkpoints,
    projects: new AnnounceProject(
      { resolve: async (cwd) => ({ id: `p:${cwd}`, root: cwd, name: cwd.split("/").at(-1)! }) },
      o.core.ingest,
      clock,
    ),
    status: o.core.broadcaster,
    clock,
    logger: o.core.logger,
    ownership: o.ownership ?? o.core.runtimes,
  });
  return { tails, discovery, presence };
}
