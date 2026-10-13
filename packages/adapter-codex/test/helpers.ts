import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyAll, emptyState, type SessionState } from "@gravita/core";
import type { GravitaEvent } from "@gravita/protocol";
import {
  type CodexSessionFiles,
  groupThreads,
  readCodexSession,
  readRolloutHead,
  type ThreadFile,
} from "../src";

export const FIXTURES = join(import.meta.dir, "../../../fixtures/codex/0.160");

export const SCENARIOS = [
  "simple-edit",
  "exec-and-patch",
  "subagents",
  "aborted-turn",
  "rate-limits",
  "nested-background",
] as const;
export type Scenario = (typeof SCENARIOS)[number];

/** A fixture's rollouts, oldest first, as $CODEX_HOME/sessions/... files. */
export async function scenarioFiles(scenario: Scenario): Promise<ThreadFile[]> {
  const root = join(FIXTURES, scenario, "sessions");
  const out: ThreadFile[] = [];
  for (const rel of (await readdir(root, { recursive: true })).sort()) {
    if (!rel.endsWith(".jsonl")) continue;
    const path = join(root, rel);
    const meta = await readRolloutHead(path);
    if (meta) out.push({ path, meta });
  }
  return out;
}

/** The one session a fixture holds. */
export async function scenarioSession(scenario: Scenario): Promise<CodexSessionFiles> {
  const sessions = groupThreads(await scenarioFiles(scenario));
  if (sessions.length !== 1) throw new Error(`${scenario}: expected one session`);
  return sessions[0]!;
}

export async function scenarioEvents(scenario: Scenario): Promise<GravitaEvent[]> {
  return readCodexSession(await scenarioSession(scenario), { projectId: "p1" });
}

export function project(events: readonly GravitaEvent[]): SessionState {
  const state = applyAll(emptyState(), events);
  const sessions = Object.values(state.sessions);
  if (sessions.length !== 1) throw new Error("expected one session");
  return sessions[0]!;
}

export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "gravita-codex-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export const ofType = <T extends GravitaEvent["type"]>(events: readonly GravitaEvent[], type: T) =>
  events.filter((e): e is Extract<GravitaEvent, { type: T }> => e.type === type);
