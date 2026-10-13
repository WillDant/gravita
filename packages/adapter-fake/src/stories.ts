import { createHash } from "node:crypto";
import { keys, projectDiscoveredEvent } from "@gravita/protocol";
import { mixSeed, Rng } from "./rng";
import { type ProjectInfo, SessionScript, type Timed } from "./script";

export const OPUS = "claude-opus-5-5";
export const HAIKU = "claude-haiku-5-5";

/** Idle time between the end of one OAuth story and the next session. */
export const IDLE_BETWEEN_SESSIONS_MS = 20_000;
const IDLE_BETWEEN_TURNS_MS = 25_000;

export function project(name: string): ProjectInfo {
  const id = createHash("sha1").update(`fake:${name}`).digest("hex").slice(0, 16);
  return { id, name, root: `/Users/demo/code/${name}` };
}

export const DEMO_PROJECTS = {
  gravita: project("gravita-demo"),
  landing: project("landing-site"),
  payments: project("payments-api"),
  todo: project("todo-app"),
} as const;

export function projectDiscovered(p: ProjectInfo): Timed {
  return { at: 0, event: projectDiscoveredEvent(p, "", { source: "fake", provider: "claude" }) };
}

/**
 * One "Add OAuth login" session: main reads, fans out to three background agents
 * (one nests an Explore and asks permission for `pnpm add jose`), then implements.
 * The session ends after the idle gap, right before the next one starts.
 */
export function oauthSession(
  seed: number,
  cycle: number,
  at: number,
): { events: Timed[]; next: number } {
  const p = DEMO_PROJECTS.gravita;
  const r = p.root;
  const s = new SessionScript(new Rng(mixSeed(seed, "oauth", cycle)), p);
  s.start(at, "chat", {
    title: "Add OAuth login",
    branch: "feat/oauth-login",
    entrypoint: "gravita",
  });
  s.presence(at, "busy");
  s.userPrompt(
    at + 200,
    "Add OAuth login with Google and GitHub. Keep the email/password flow working.",
  );

  const main = s.main(at + 400);
  main.think(900).say("I'll look at how auth works today, then split the research.", 900);
  main.todo([
    { content: "Map the current auth flow", status: "in_progress" },
    { content: "Find where sessions are stored", status: "pending" },
    { content: "Plan the OAuth migration", status: "pending" },
    { content: "Wire up OAuth routes and the login page", status: "pending" },
  ]);
  main
    .tool(
      "Read",
      { file_path: `${r}/src/server/auth/session.ts` },
      { ms: 500, output: "export async function createSession(userId: string) {" },
    )
    .tool(
      "Glob",
      { pattern: "src/**/auth/**/*.ts", path: r },
      {
        ms: 400,
        output: "src/server/auth/login.ts src/server/auth/middleware.ts src/server/auth/session.ts",
      },
    )
    .tool(
      "Grep",
      { pattern: "createSession", path: `${r}/src` },
      { ms: 500, output: "Found 4 files" },
    )
    .say("Auth is cookie-based. I'll map it in parallel: two explorers and a planner.", 700);

  const mapper = main.spawn(
    "Explore",
    "Map auth code",
    "Map every file involved in login, logout and session checks.",
    { background: true, model: HAIKU },
  );
  const store = main.spawn(
    "Explore",
    "Find session store",
    "Find where sessions are persisted and how they expire.",
    { background: true, model: HAIKU },
  );
  const planner = main.spawn(
    "Plan",
    "Plan migration",
    "Plan adding Google and GitHub OAuth without breaking password login.",
    { background: true, model: OPUS },
  );
  main.say("Three agents are on it. I'll wait for their reports.", 600);

  mapper
    .think(700)
    .tool("Glob", { pattern: "src/**/*.{ts,tsx}", path: r }, { ms: 600, output: "182 files" })
    .tool("Read", { file_path: `${r}/src/server/auth/login.ts` }, { ms: 700 })
    .tool("Read", { file_path: `${r}/src/server/auth/middleware.ts` }, { ms: 600 })
    .progress("Found the password login and the auth middleware")
    .tool(
      "Grep",
      { pattern: "req\\.session", path: `${r}/src` },
      { ms: 800, output: "Found 9 files" },
    )
    .tool("Read", { file_path: `${r}/src/client/pages/Login.tsx` }, { ms: 700 })
    .say("Login posts to /api/login; middleware.ts guards /app/* with the session cookie.", 900)
    .finish(
      "Auth is cookie-based: login.ts checks passwords, middleware.ts guards /app/*, Login.tsx posts to /api/login.",
    );

  store
    .think(800)
    .tool(
      "Grep",
      { pattern: "sessionStore|connect-pg-simple", path: `${r}/src` },
      { ms: 700, output: "src/server/db/sessions.ts" },
    )
    .tool("Read", { file_path: `${r}/src/server/db/sessions.ts` }, { ms: 600 })
    .tool(
      "Bash",
      { command: 'rg -n "create table sessions" migrations' },
      { ms: 900, output: "migrations/0007_sessions.sql:1:create table sessions (" },
    )
    .tool("Read", { file_path: `${r}/migrations/0007_sessions.sql` }, { ms: 500 })
    .say("Sessions are rows in Postgres with a 30-day TTL.", 700)
    .finish(
      "Sessions live in Postgres (sessions table, 30-day TTL) behind src/server/db/sessions.ts.",
    );

  planner
    .think(1200)
    .tool("Read", { file_path: `${r}/docs/architecture.md` }, { ms: 600 })
    .tool(
      "WebFetch",
      {
        url: "https://developers.google.com/identity/openid-connect/openid-connect",
        prompt: "Summarize the authorization code flow with PKCE",
      },
      {
        ms: 2200,
        output:
          "Use the authorization code flow with PKCE; validate the id_token signature, aud and nonce.",
      },
    )
    .tool(
      "mcp__github__search_issues",
      { query: "repo:acme/gravita-demo oauth" },
      { ms: 1200, output: "#142 Sign in with Google (open)" },
    );
  const routes = planner.spawn(
    "Explore",
    "Find OAuth callback routes",
    "Find where /auth/:provider/callback would fit in the router.",
    { background: false, model: HAIKU },
  );
  routes
    .think(600)
    .tool(
      "Glob",
      { pattern: "src/server/routes/**/*.ts", path: r },
      { ms: 500, output: "src/server/routes/auth.ts src/server/routes/index.ts" },
    )
    .tool(
      "Grep",
      { pattern: 'router\\.(get|post)\\("/auth', path: `${r}/src/server/routes` },
      { ms: 600, output: "src/server/routes/auth.ts:12" },
    )
    .tool("Read", { file_path: `${r}/src/server/routes/auth.ts` }, { ms: 600 })
    .say(
      "Auth routes are registered in src/server/routes/auth.ts; callbacks fit next to POST /login.",
      700,
    )
    .finish("Callbacks belong in src/server/routes/auth.ts, next to POST /login.");
  planner
    .progress("Callback routes located; checking dependencies")
    .tool(
      "Bash",
      { command: "pnpm add jose" },
      { ms: 2600, output: "+ jose 6.1.0", permission: { waitMs: 8_000 } },
    )
    .tool(
      "Write",
      { file_path: `${r}/docs/oauth-plan.md`, content: "# OAuth migration plan" },
      { ms: 500, changes: [{ path: `${r}/docs/oauth-plan.md`, added: 48, removed: 0 }] },
    )
    .say(
      "Plan: /auth/:provider routes with PKCE via jose, link accounts by verified email, keep cookie sessions.",
      900,
    )
    .finish(
      "Plan ready: /auth/:provider + callback routes, PKCE and id_token checks with jose, account linking by verified email.",
    );

  main.t = Math.max(main.t, mapper.t, store.t, planner.t) + 800;
  main.say("All three reports are in. Implementing the plan now.", 800);
  main.todo([
    { content: "Map the current auth flow", status: "completed" },
    { content: "Find where sessions are stored", status: "completed" },
    { content: "Plan the OAuth migration", status: "completed" },
    { content: "Wire up OAuth routes and the login page", status: "in_progress" },
  ]);
  const edit = (path: string, added: number, removed: number) => ({
    ms: 500,
    changes: [{ path: `${r}/${path}`, added, removed }],
  });
  main
    .tool(
      "Edit",
      {
        file_path: `${r}/src/server/routes/auth.ts`,
        old_string: "router.post",
        new_string: "router.get",
      },
      edit("src/server/routes/auth.ts", 24, 3),
    )
    .tool(
      "Write",
      { file_path: `${r}/src/server/auth/oauth.ts`, content: "export function oauth() {}" },
      edit("src/server/auth/oauth.ts", 86, 0),
    )
    .tool(
      "Edit",
      {
        file_path: `${r}/src/client/pages/Login.tsx`,
        old_string: "<form",
        new_string: "<OAuthButtons />",
      },
      edit("src/client/pages/Login.tsx", 18, 2),
    )
    .tool(
      "Edit",
      { file_path: `${r}/.env.example`, old_string: "", new_string: "GOOGLE_CLIENT_ID=" },
      edit(".env.example", 4, 0),
    )
    .tool(
      "Bash",
      { command: "pnpm test --filter auth", description: "Run the auth tests" },
      { ms: 3200, output: "✓ 14 tests passed" },
    )
    .say(
      "OAuth login works for Google and GitHub; password login is untouched and the auth tests pass.",
      600,
    );
  main.endTurn(at, Math.round((0.6 + s.rng.next() * 0.5) * 100) / 100);

  const next = Math.round(main.t + IDLE_BETWEEN_SESSIONS_MS);
  s.push(next - 1, "session.ended", keys.sessionEnded(s.sessionId), { reason: "exit" });
  return { events: s.sorted(), next };
}

const LANDING_TURNS: { prompt: string; edits: [string, number, number][]; reply: string }[] = [
  {
    prompt: "Tighten the hero copy and make the CTA stand out",
    edits: [
      ["src/components/Hero.astro", 12, 7],
      ["src/styles/hero.css", 9, 4],
    ],
    reply:
      "Shorter headline, one-line subhead, and the CTA now uses the accent color with more padding.",
  },
  {
    prompt: "Make the hero responsive below 640px",
    edits: [
      ["src/styles/hero.css", 22, 6],
      ["src/components/Hero.astro", 4, 2],
    ],
    reply: "The hero stacks on small screens and the headline scales with clamp().",
  },
  {
    prompt: "Lazy-load the hero illustration",
    edits: [
      ["src/components/Hero.astro", 6, 3],
      ["astro.config.mjs", 3, 0],
    ],
    reply: "The illustration is lazy-loaded with explicit dimensions, so layout no longer shifts.",
  },
  {
    prompt: "Add a subtle fade-in to the headline",
    edits: [
      ["src/styles/hero.css", 14, 0],
      ["src/components/Hero.astro", 2, 1],
    ],
    reply: "Added a 400ms fade-in that respects prefers-reduced-motion.",
  },
];

/** One long terminal session in a second project: a single agent polishing a landing page. */
export function* landingSession(seed: number, startAt: number): Generator<Timed, never> {
  const p = DEMO_PROJECTS.landing;
  const s = new SessionScript(new Rng(mixSeed(seed, "landing")), p);
  s.start(startAt, "external", {
    title: "Polish the hero section",
    branch: "main",
    entrypoint: "cli",
  });
  let at = startAt;
  for (let turn = 0; ; turn++) {
    const t = LANDING_TURNS[turn % LANDING_TURNS.length]!;
    s.presence(at, "busy");
    s.userPrompt(at + 100, t.prompt);
    const main = s
      .main(at + 300)
      .think(800)
      .say("On it.", 500);
    for (const [path, added, removed] of t.edits) {
      main
        .tool("Read", { file_path: `${p.root}/${path}` }, { ms: 400 })
        .tool(
          "Edit",
          { file_path: `${p.root}/${path}`, old_string: "", new_string: "" },
          { ms: 500, changes: [{ path: `${p.root}/${path}`, added, removed }] },
        );
    }
    main
      .tool(
        "Bash",
        { command: "pnpm build", description: "Build the site" },
        { ms: 2400, output: "✓ built in 2.1s" },
      )
      .say(t.reply, 400);
    main.endTurn(at, Math.round((0.05 + s.rng.next() * 0.1) * 100) / 100);
    yield* s.sorted();
    s.events.length = 0;
    at = Math.round(main.t + IDLE_BETWEEN_TURNS_MS);
  }
}

export function* oauthSessions(seed: number, startAt: number): Generator<Timed, never> {
  let at = startAt;
  for (let cycle = 0; ; cycle++) {
    const { events, next } = oauthSession(seed, cycle, at);
    yield* events;
    at = next;
  }
}
