import { keys } from "@gravita/protocol";
import { mixSeed, Rng } from "./rng";
import { SessionScript, type Timed } from "./script";
import { DEMO_PROJECTS, IDLE_BETWEEN_SESSIONS_MS } from "./stories";

/** The model the Codex story's agents report usage for. */
export const CODEX_MODEL = "gpt-5.5-codex";

/**
 * "Speed up the CI tests", a Codex session watched from the terminal: main checks the
 * workflow, sends one explorer to find the slow suites, patches two files and runs the
 * tests. Short and calm on purpose: no permission prompt, no failure. Ends after the idle gap.
 */
export function codexSession(
  seed: number,
  cycle: number,
  at: number,
): { events: Timed[]; next: number } {
  const p = DEMO_PROJECTS.build;
  const r = p.root;
  const s = new SessionScript(new Rng(mixSeed(seed, "codex", cycle)), p, { provider: "codex" });
  s.start(at, "external", {
    title: "Speed up the CI tests",
    branch: "ci/faster-tests",
    entrypoint: "cli",
    model: CODEX_MODEL,
    permissionMode: "workspace",
    cliVersion: "0.161.0",
  });
  s.presence(at, "busy");
  s.userPrompt(at + 200, "CI tests take 14 minutes. Cache pnpm and split the slow suites.");

  const main = s.main(at + 400, CODEX_MODEL);
  main
    .think(900)
    .tool(
      "exec_command",
      { cmd: "rg -n 'pnpm install|vitest' .github/workflows" },
      { ms: 600, output: ".github/workflows/ci.yml:31: run: pnpm install --frozen-lockfile" },
    )
    .say("No pnpm cache in ci.yml. I'll have an explorer find the slowest suites.", 700);

  const explorer = main.spawn(
    "explorer",
    "Find the slow test suites",
    "Find the slowest vitest suites and what makes them slow.",
    { background: false, model: CODEX_MODEL },
  );
  explorer
    .think(700)
    .tool(
      "exec_command",
      { cmd: "rg --files -g '*.test.ts' packages" },
      { ms: 500, output: "86 files" },
    )
    .tool(
      "exec_command",
      { cmd: "sed -n '1,60p' vitest.config.ts" },
      {
        ms: 400,
        output: "export default defineConfig({ test: { pool: 'forks', maxWorkers: 1 } })",
      },
    )
    .say("Every suite runs in one worker; the e2e suites alone take nine minutes.", 600)
    .finish("Tests run on a single worker; e2e suites take 9 of the 14 minutes.");

  const ci = `${r}/.github/workflows/ci.yml`;
  const config = `${r}/vitest.config.ts`;
  main
    .say("Caching pnpm, running workers in parallel and sharding the e2e suites.", 700)
    .tool(
      "apply_patch",
      { path: ci },
      {
        ms: 600,
        changes: [
          { path: ci, added: 14, removed: 3 },
          { path: config, added: 6, removed: 2 },
        ],
      },
    )
    .tool(
      "exec_command",
      { cmd: "pnpm test --shard=1/3" },
      { ms: 2600, output: "Test Files  29 passed (29)" },
    )
    .say("CI should drop to about five minutes: pnpm is cached and e2e runs in three shards.", 500);
  main.endTurn(at);

  const next = Math.round(main.t + IDLE_BETWEEN_SESSIONS_MS);
  s.push(next - 1, "session.ended", keys.sessionEnded(s.sessionId), { reason: "exit" });
  return { events: s.sorted(), next };
}

export function* codexSessions(seed: number, startAt: number): Generator<Timed, never> {
  let at = startAt;
  for (let cycle = 0; ; cycle++) {
    const { events, next } = codexSession(seed, cycle, at);
    yield* events;
    at = next;
  }
}
