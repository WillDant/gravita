import { cp } from "node:fs/promises";
import { join } from "node:path";
import type { RolloutFs } from "@gravita/adapter-codex";
import type { Clock } from "../src/application/ports/clock";
import type { SessionOwnership } from "../src/application/ports/session-runtime";
import { AnnounceProject } from "../src/application/usecases/announce-project";
import { CursorPresence } from "../src/infrastructure/cursor/cursor-presence";
import {
  type CursorDiscoveryFs,
  CursorSessionDiscovery,
} from "../src/infrastructure/cursor/cursor-session-discovery";
import { CursorSessionSource } from "../src/infrastructure/cursor/cursor-session-source";
import { TailScheduler } from "../src/infrastructure/sessions/tail-scheduler";
import type { EngineCore } from "../src/main/container";

export const CURSOR_FIXTURES = join(import.meta.dir, "../../../fixtures/cursor/2026.10.14");

/** The chats of the subagents scenario: the root, and the subagent it started. */
export const ROOT_CHAT = "d14e9854-78f5-4d95-8616-e5b413d11ab5";
export const CHILD_CHAT = "0af03c5f-4a38-4782-8964-b2bbf55847cc";

/** Copies a scenario's `projects/` and `chats/` into a Cursor home. */
export async function installCursorFixture(cursorHome: string, scenario: string) {
  await cp(join(CURSOR_FIXTURES, scenario), cursorHome, { recursive: true });
}

export interface CursorTailsOptions {
  cursorHome: string;
  core: EngineCore;
  clock?: Clock;
  ownership?: SessionOwnership;
  fs?: CursorDiscoveryFs;
  rolloutFs?: RolloutFs;
}

/** A tail scheduler with only the Cursor source, on a core's stores. */
export function cursorTails(o: CursorTailsOptions) {
  const clock = o.clock ?? o.core.clock;
  const discovery = new CursorSessionDiscovery({
    cursorHome: o.cursorHome,
    lookbackDays: 14,
    clock,
    ...(o.fs ? { fs: o.fs } : {}),
    ...(o.rolloutFs ? { rolloutFs: o.rolloutFs } : {}),
  });
  const presence = new CursorPresence({ ingest: o.core.ingest, clock });
  const tails = new TailScheduler({
    sources: [
      new CursorSessionSource({
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
