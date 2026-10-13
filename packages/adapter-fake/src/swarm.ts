import { keys } from "@gravita/protocol";
import { mixSeed, Rng } from "./rng";
import { type Actor, SessionScript, type Timed } from "./script";
import { DEMO_PROJECTS, HAIKU, IDLE_BETWEEN_SESSIONS_MS, OPUS } from "./stories";

/** Subagents the main agent launches in its one fan-out message. */
export const SWARM_SIZE = 9;

/**
 * "Audit before release": main launches nine subagents in ONE message (parallel Agent
 * calls, so their spawns sit at consecutive columns and the map links the capsules).
 * One nests an Explore, two stop on a permission prompt, one fails, the rest finish at
 * staggered times; then main writes the report. Ends after the idle gap.
 */
export function swarmSession(
  seed: number,
  cycle: number,
  at: number,
): { events: Timed[]; next: number } {
  const p = DEMO_PROJECTS.payments;
  const r = p.root;
  const s = new SessionScript(new Rng(mixSeed(seed, "swarm", cycle)), p);
  s.start(at, "chat", {
    title: "Audit before release",
    branch: "release/2.4",
    entrypoint: "gravita",
  });
  s.presence(at, "busy");
  s.userPrompt(
    at + 200,
    "Audit the payments service before we cut 2.4: routes, refunds, webhooks, migrations, deps and tests.",
  );

  const main = s.main(at + 400);
  main
    .think(800)
    .tool("Glob", { pattern: "src/**/*.ts", path: r }, { ms: 400, output: "214 files", gap: 900 })
    .say("Nine areas to cover. I'll send one agent to each, all at once.", 600);

  const fg = { background: false };
  const routes = main.spawn("Explore", "Map payment routes", "List every payment route.", {
    ...fg,
    model: HAIKU,
  });
  const secrets = main.spawn("Explore", "Find hardcoded secrets", "Scan for keys in code.", {
    ...fg,
    model: HAIKU,
  });
  const plan = main.spawn("Plan", "Plan the release checklist", "Draft the 2.4 checklist.", {
    ...fg,
    model: OPUS,
  });
  const tests = main.spawn("general-purpose", "Run the test suite", "Run all tests.", {
    ...fg,
    model: OPUS,
  });
  const review = main.spawn("code-reviewer", "Review the refund flow", "Review refunds.", {
    ...fg,
    model: OPUS,
  });
  const deps = main.spawn("general-purpose", "Upgrade the Stripe SDK", "Bump stripe.", {
    ...fg,
    model: OPUS,
  });
  const hooks = main.spawn("Explore", "Audit webhook handlers", "Check webhook handling.", {
    ...fg,
    model: HAIKU,
  });
  const migrations = main.spawn("general-purpose", "Check DB migrations", "Dry-run migrations.", {
    ...fg,
    model: OPUS,
  });
  const pii = main.spawn("Explore", "Scan logs for PII", "Find personal data in logs.", {
    ...fg,
    model: HAIKU,
  });

  routes
    .think(600)
    .tool("Glob", { pattern: "src/routes/**/*.ts", path: r }, { ms: 500, output: "12 files" })
    .tool("Read", { file_path: `${r}/src/routes/payments.ts` }, { ms: 600 })
    .tool("Read", { file_path: `${r}/src/routes/refunds.ts` }, { ms: 500 })
    .tool(
      "Grep",
      { pattern: "requireAuth", path: `${r}/src/routes` },
      { ms: 600, output: "Found 11 files" },
    )
    .tool("Read", { file_path: `${r}/src/routes/webhooks.ts` }, { ms: 600 })
    .say("Twelve routes; all behind requireAuth except the webhook endpoint.", 600);

  secrets
    .think(500)
    .tool(
      "Grep",
      { pattern: "sk_(live|test)_", path: `${r}/src` },
      { ms: 900, output: "No matches" },
    )
    .tool("Read", { file_path: `${r}/.env.example` }, { ms: 400 })
    .say("No secrets in code; .env.example only has placeholders.", 500);

  plan
    .think(1400)
    .tool("Read", { file_path: `${r}/CHANGELOG.md` }, { ms: 600 })
    .tool("Read", { file_path: `${r}/docs/release.md` }, { ms: 500 })
    .tool(
      "WebFetch",
      {
        url: "https://docs.stripe.com/upgrades",
        prompt: "What changed in the latest Stripe API version?",
      },
      { ms: 2_400, output: "Two breaking changes affect refunds and payouts." },
    )
    .tool(
      "Write",
      { file_path: `${r}/docs/release-2.4.md`, content: "# 2.4 checklist" },
      { ms: 500, changes: [{ path: `${r}/docs/release-2.4.md`, added: 36, removed: 0 }] },
    )
    .say("Checklist drafted: freeze, migrate, canary at 5%, then full rollout.", 700);

  tests
    .think(700)
    .tool(
      "Bash",
      { command: "pnpm test", description: "Run the whole test suite" },
      { ms: 6_500, output: "✓ 412 tests passed", permission: { waitMs: 16_000 } },
    )
    .say("All 412 tests pass.", 500);

  review
    .think(900)
    .tool("Read", { file_path: `${r}/src/refunds/refund.ts` }, { ms: 700 })
    .tool("Read", { file_path: `${r}/src/refunds/ledger.ts` }, { ms: 600 })
    .tool(
      "Grep",
      { pattern: "idempotencyKey", path: `${r}/src/refunds` },
      { ms: 500, output: "Found 2 files" },
    )
    .progress("Refunds are idempotent; checking partial refunds")
    .tool("Read", { file_path: `${r}/src/refunds/partial.ts` }, { ms: 700 })
    .tool("Read", { file_path: `${r}/test/refunds.test.ts` }, { ms: 600 })
    .tool(
      "Bash",
      { command: "pnpm test refunds", description: "Run the refund tests" },
      { ms: 2_200, output: "✓ 38 tests passed" },
    )
    .say("Partial refunds can round twice; suggest integer cents end to end.", 600);

  deps
    .think(600)
    .tool("Read", { file_path: `${r}/package.json` }, { ms: 400 })
    .tool(
      "Bash",
      { command: "pnpm add stripe@latest" },
      { ms: 3_000, output: "+ stripe 19.2.0", permission: { waitMs: 22_000 } },
    )
    .tool(
      "Edit",
      {
        file_path: `${r}/src/stripe/client.ts`,
        old_string: "apiVersion",
        new_string: "apiVersion",
      },
      { ms: 500, changes: [{ path: `${r}/src/stripe/client.ts`, added: 3, removed: 3 }] },
    )
    .say("Stripe 19.2 is in; the client pins the new API version.", 500);

  hooks.think(600).tool("Read", { file_path: `${r}/src/webhooks/stripe.ts` }, { ms: 600 });
  const retries = hooks.spawn(
    "Explore",
    "Trace webhook retries",
    "Find how failed webhook deliveries are retried.",
    { background: false, model: HAIKU },
  );
  retries
    .think(500)
    .tool(
      "Grep",
      { pattern: "retry|backoff", path: `${r}/src/webhooks` },
      { ms: 600, output: "src/webhooks/queue.ts" },
    )
    .tool("Read", { file_path: `${r}/src/webhooks/queue.ts` }, { ms: 600 })
    .say("Retries use exponential backoff, capped at 6 attempts.", 500)
    .finish(
      "Webhook retries back off exponentially, at most 6 attempts, from src/webhooks/queue.ts.",
    );
  hooks
    .tool(
      "Grep",
      { pattern: "constructEvent", path: `${r}/src` },
      { ms: 500, output: "src/webhooks/stripe.ts:18" },
    )
    .say("Signatures are verified before any work; retries are bounded.", 500);

  migrations
    .think(700)
    .tool(
      "Glob",
      { pattern: "migrations/*.sql", path: r },
      { ms: 400, output: "migrations/0001_init.sql … migrations/0012_refunds.sql" },
    )
    .tool(
      "Bash",
      { command: "pnpm db:migrate --dry-run" },
      { ms: 2_400, error: 'relation "refund_items" does not exist' },
    );

  pii
    .think(500)
    .tool(
      "Grep",
      { pattern: "logger\\.(info|debug)\\(.*(email|card)", path: `${r}/src` },
      { ms: 800, output: "src/payments/charge.ts:88" },
    )
    .tool("Read", { file_path: `${r}/src/payments/charge.ts` }, { ms: 500 })
    .tool(
      "Grep",
      { pattern: "console\\.log", path: `${r}/src` },
      { ms: 600, output: "Found 3 files" },
    )
    .tool("Read", { file_path: `${r}/src/lib/logger.ts` }, { ms: 500 })
    .say("charge.ts logs the customer email at info level.", 500);

  // Each agent reports back when its own work ends, so the merges land one by one.
  const endings: [Actor, (a: Actor) => void][] = [
    [routes, (a) => a.finish("12 payment routes; all authenticated except the signed webhook.")],
    [secrets, (a) => a.finish("No hardcoded secrets; .env.example holds placeholders only.")],
    [plan, (a) => a.finish("Release checklist in docs/release-2.4.md.")],
    [tests, (a) => a.finish("412 tests pass.")],
    [review, (a) => a.finish("Refunds are idempotent; partial refunds can round twice.")],
    [deps, (a) => a.finish("Stripe SDK upgraded to 19.2.0.")],
    [hooks, (a) => a.finish("Webhooks verify signatures and retry with a bounded backoff.")],
    [
      migrations,
      (a) =>
        a.fail('Migration 0012 fails on a clean database: relation "refund_items" does not exist.'),
    ],
    [pii, (a) => a.finish("One leak: charge.ts logs the customer email at info level.")],
  ];
  for (const [agent, end] of endings.sort(([a], [b]) => a.t - b.t)) end(agent);

  main
    .say(
      "Eight of nine areas are clear. Migration 0012 fails on a clean database, and charge.ts logs emails.",
      800,
    )
    .tool(
      "Write",
      { file_path: `${r}/docs/audit-2.4.md`, content: "# Audit before 2.4" },
      { ms: 500, changes: [{ path: `${r}/docs/audit-2.4.md`, added: 54, removed: 0 }] },
    )
    .say("The audit is in docs/audit-2.4.md. Fix 0012 before cutting the release.", 500);
  main.endTurn(at, Math.round((1.2 + s.rng.next() * 0.6) * 100) / 100);

  const next = Math.round(main.t + IDLE_BETWEEN_SESSIONS_MS);
  s.push(next - 1, "session.ended", keys.sessionEnded(s.sessionId), { reason: "exit" });
  return { events: s.sorted(), next };
}

export function* swarmSessions(seed: number, startAt: number): Generator<Timed, never> {
  let at = startAt;
  for (let cycle = 0; ; cycle++) {
    const { events, next } = swarmSession(seed, cycle, at);
    yield* events;
    at = next;
  }
}
