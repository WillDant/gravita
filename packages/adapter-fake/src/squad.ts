import {
  type GravitaEvent,
  type GravitaEventType,
  keys,
  type SquadPhase,
  type SquadPlan,
  type TaskStatus,
} from "@gravita/protocol";
import { mixSeed, Rng } from "./rng";
import { type Actor, type DataOf, SessionScript, type Timed } from "./script";
import { DEMO_PROJECTS, HAIKU, IDLE_BETWEEN_SESSIONS_MS } from "./stories";

// A scripted Squad run: a planner proposes a plan (the first one is rejected), the user
// approves it, the backend lays the foundation and freezes the contract, then backend,
// frontend and tests build in parallel, each task in its own role session. One task
// steps outside its role's paths, one merge conflicts, the squad crosses 75% of its
// budget, and the tests role runs the final checks. The first squad stops at "deliver",
// waiting for the user; the looped copies deliver themselves (as a branch) after a pause.

const TODO = DEMO_PROJECTS.todo;
const DEMO_HOME = "/Users/demo";

export const SQUAD_BRIEF =
  "Build a small todo app: API with Hono, web UI with React, tests with Vitest.";
export const SQUAD_BUDGET_USD = 25;
/** How long the user looks at the plan before approving it. */
const REVIEW_MS = 8_000;
/** How long a looped squad waits in "deliver" before it delivers itself. */
const DELIVER_WAIT_MS = 12_000;

/** The plan the planner proposes on its second attempt, and the user approves. */
export const SAMPLE_SQUAD_PLAN: SquadPlan = {
  goal: SQUAD_BRIEF,
  summary:
    "A Hono API stores todos in SQLite and serves them as JSON; a React app lists, adds, completes and deletes them. The API shape is frozen in an OpenAPI contract first, so the web client and the tests build against it in parallel.",
  stack: ["typescript", "hono", "sqlite", "react", "vite", "vitest", "playwright"],
  roles: [
    {
      id: "backend",
      name: "Backend",
      kind: "backend",
      owns: ["apps/api/", "packages/contracts/"],
      charter:
        "Own the API and its contract. Keep the OpenAPI file the single source of truth for the Todo shape; answer change requests from the other roles.",
    },
    {
      id: "frontend",
      name: "Frontend",
      kind: "frontend",
      owns: ["apps/web/"],
      charter:
        "Own the web app. Use the types from packages/contracts; never edit the API. Ask the backend for API changes.",
    },
    {
      id: "tests",
      name: "Tests",
      kind: "tests",
      owns: ["tests/", "e2e/"],
      charter:
        "Own the API tests and the end-to-end tests. Test through HTTP and the browser, never by importing app internals.",
    },
  ],
  shared: {
    paths: [
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "tsconfig.base.json",
      ".github/",
    ],
    strategy: "regenerate",
  },
  contracts: [
    {
      path: "packages/contracts/openapi.yaml",
      owner: "backend",
      kind: "openapi",
      description: "The /todos endpoints and the Todo schema, plus the generated TypeScript types.",
    },
  ],
  tasks: [
    {
      id: "scaffold-api",
      role: "backend",
      title: "Scaffold the API",
      plainSummary: "Sets up an empty API server that starts and answers a health check.",
      dependsOn: [],
      writes: ["apps/api/package.json", "apps/api/tsconfig.json", "apps/api/src/index.ts"],
      acceptance: ["pnpm -C apps/api dev starts the server", "GET /health answers 200"],
      size: "s",
      foundation: true,
    },
    {
      id: "contracts",
      role: "backend",
      title: "Todo API contract",
      plainSummary:
        "Writes down exactly what the API accepts and returns, so everyone builds to it.",
      dependsOn: ["scaffold-api"],
      writes: ["packages/contracts/"],
      acceptance: ["openapi.yaml lints clean", "Todo types are generated from it"],
      size: "s",
      foundation: true,
    },
    {
      id: "api-store",
      role: "backend",
      title: "Todo storage",
      plainSummary: "Saves todos in a small SQLite database so they survive a restart.",
      dependsOn: ["scaffold-api"],
      writes: ["apps/api/src/db/"],
      acceptance: ["Todos persist across restarts", "Migrations run on start"],
      size: "m",
    },
    {
      id: "api-routes",
      role: "backend",
      title: "Todo routes",
      plainSummary: "Lets the app list, add, complete and delete todos over HTTP.",
      dependsOn: ["contracts", "api-store"],
      writes: ["apps/api/src/routes/", "apps/api/src/app.ts", "apps/api/src/types.ts"],
      acceptance: ["Every route in openapi.yaml is served", "Invalid input answers 400"],
      size: "m",
    },
    {
      id: "web-shell",
      role: "frontend",
      title: "Web app shell",
      plainSummary: "Creates the web page the todo list lives in.",
      dependsOn: ["contracts"],
      writes: [
        "apps/web/package.json",
        "apps/web/index.html",
        "apps/web/vite.config.ts",
        "apps/web/src/main.tsx",
        "apps/web/src/App.tsx",
      ],
      acceptance: ["pnpm -C apps/web dev serves the page"],
      size: "s",
    },
    {
      id: "web-client",
      role: "frontend",
      title: "API client",
      plainSummary: "Connects the web page to the API, using the shapes from the contract.",
      dependsOn: ["contracts"],
      writes: ["apps/web/src/api/"],
      acceptance: ["Typed calls for every /todos route"],
      size: "s",
    },
    {
      id: "web-todos",
      role: "frontend",
      title: "Todo list UI",
      plainSummary: "Shows the todos and lets people add, tick off and delete them.",
      dependsOn: ["web-shell", "web-client"],
      writes: ["apps/web/src/components/", "apps/web/src/App.tsx", "apps/web/src/styles.css"],
      acceptance: ["Add, complete and delete work", "Empty state when there are no todos"],
      size: "m",
    },
    {
      id: "tests-api",
      role: "tests",
      title: "API tests",
      plainSummary: "Checks every API route against the contract.",
      dependsOn: ["contracts"],
      writes: ["tests/api/", "tests/vitest.config.ts"],
      acceptance: ["One test per route and error case"],
      size: "m",
    },
    {
      id: "tests-e2e",
      role: "tests",
      title: "End-to-end tests",
      plainSummary: "Clicks through the app in a real browser, like a person would.",
      dependsOn: ["api-routes", "web-todos"],
      writes: ["e2e/"],
      acceptance: ["Add, complete and delete pass in Chromium"],
      size: "m",
    },
  ],
  checks: [
    {
      id: "typecheck",
      argv: ["pnpm", "-r", "typecheck"],
      cwd: ".",
      when: "task",
      description: "Types compile in every package.",
    },
    {
      id: "unit",
      argv: ["pnpm", "-r", "test"],
      cwd: ".",
      when: "integration",
      description: "Unit and API tests.",
    },
    {
      id: "build",
      argv: ["pnpm", "-r", "build"],
      cwd: ".",
      when: "integration",
      description: "Every package builds.",
    },
    {
      id: "e2e",
      argv: ["pnpm", "exec", "playwright", "test"],
      cwd: ".",
      when: "final",
      description: "The browser tests, against the built app.",
    },
  ],
  assumptions: [
    "No sign-in: one shared list of todos.",
    "SQLite in a local file is enough; no hosted database.",
    "Node 22 and pnpm 10.",
  ],
  questions: ["Should completed todos stay visible, or move to a separate list?"],
};

/** The planner's first attempt: the tests role also claims the API's test folder. */
const FIRST_PROPOSAL: SquadPlan = {
  ...SAMPLE_SQUAD_PLAN,
  roles: SAMPLE_SQUAD_PLAN.roles.map((r) =>
    r.id === "tests" ? { ...r, owns: ["apps/api/test/", "e2e/"] } : r,
  ),
  tasks: SAMPLE_SQUAD_PLAN.tasks.map((t) =>
    t.id === "tests-api" ? { ...t, writes: ["apps/api/test/"] } : t,
  ),
};

/** What @gravita/core's validatePlan says about the first proposal (asserted in a test). */
const FIRST_PROPOSAL_ERRORS = [
  'Roles "backend" and "tests" overlap: "apps/api/" and "apps/api/test/"; each path needs a single owner.',
];

const ROLE_NAMES: Record<string, string> = {
  planner: "Planner",
  backend: "Backend",
  frontend: "Frontend",
  tests: "Tests",
};

const TASKS = new Map(SAMPLE_SQUAD_PLAN.tasks.map((t) => [t.id, t]));
const task = (id: string) => TASKS.get(id)!;

const round2 = (n: number) => Math.round(n * 100) / 100;

interface RoleRun {
  s: SessionScript;
  main: Actor;
  /** Absolute path of the role's worktree (or the repo, for the planner). */
  wt: string;
  startedAt: number;
}

/** One squad, start to deliver. Collects squad facts and every role session it starts. */
class SquadRun {
  readonly squadId: string;
  private readonly rng: Rng;
  private readonly facts: Timed[] = [];
  private readonly scripts: SessionScript[] = [];
  private readonly costs: { at: number; usd: number }[] = [];
  private readonly phaseRounds = new Map<string, number>();

  constructor(
    private readonly seed: number,
    private readonly cycle: number,
  ) {
    this.rng = new Rng(mixSeed(seed, "squad", cycle));
    this.squadId = `sq-${this.rng.hex(8)}`;
  }

  emit<T extends GravitaEventType>(
    at: number,
    type: T,
    key: string,
    data: Omit<DataOf<T>, "squadId">,
  ) {
    const event = {
      key,
      ts: "",
      source: "fake",
      provider: "fake",
      projectId: TODO.id,
      type,
      data: { squadId: this.squadId, ...data },
    } as GravitaEvent;
    this.facts.push({ at: Math.round(at), event });
  }

  phase(at: number, phase: SquadPhase, reason?: string) {
    const round = (this.phaseRounds.get(phase) ?? 0) + 1;
    this.phaseRounds.set(phase, round);
    this.emit(at, "squad.phase_changed", keys.squadPhase(this.squadId, phase, round), {
      phase,
      ...(reason ? { reason } : {}),
    });
  }

  task(
    at: number,
    taskId: string,
    status: TaskStatus,
    attempt: number,
    extra: { sessionId?: string; reason?: string } = {},
  ) {
    this.emit(at, "task.status_changed", keys.taskStatus(this.squadId, taskId, attempt, status), {
      taskId,
      status,
      attempt,
      role: task(taskId).role,
      ...extra,
    });
  }

  sha(): string {
    return this.rng.hex(40);
  }

  /** ±8% so different cycles don't cost exactly the same. */
  cost(base: number): number {
    return round2(base * (0.92 + this.rng.next() * 0.16));
  }

  worktree(role: string): string {
    return `${DEMO_HOME}/.gravita/worktrees/${TODO.name}/${this.squadId}/${role}`;
  }

  /** Starts a role's Claude Code session in its worktree, prompted by Gravita. */
  session(
    at: number,
    role: string,
    opts: { taskId?: string; attempt?: number; title: string; prompt: string },
  ): RoleRun {
    const planner = role === "planner";
    const wt = planner ? TODO.root : this.worktree(role);
    const s = new SessionScript(
      new Rng(mixSeed(this.seed, "squad", this.cycle, role, opts.taskId ?? "-", opts.attempt ?? 1)),
      { ...TODO, root: wt },
    );
    s.start(at, "squad", {
      title: opts.title,
      branch: planner ? "main" : `gravita/${this.squadId}/${role}`,
      entrypoint: "gravita",
      squad: {
        squadId: this.squadId,
        roleId: role,
        ...(opts.taskId ? { taskId: opts.taskId } : {}),
      },
    });
    s.presence(at, "busy");
    s.userPrompt(at + 200, opts.prompt, "gravita");
    this.scripts.push(s);
    return { s, main: s.main(at + 400), wt, startedAt: at };
  }

  /** Starts a task's session and marks the task running with it. */
  run(at: number, taskId: string, attempt: number, prompt: string, reason?: string): RoleRun {
    const t = task(taskId);
    const r = this.session(at, t.role, {
      taskId,
      attempt,
      title: `${ROLE_NAMES[t.role]}: ${t.title}`,
      prompt,
    });
    this.task(at, taskId, "running", attempt, {
      sessionId: r.s.sessionId,
      ...(reason ? { reason } : {}),
    });
    return r;
  }

  /** Ends the turn, reports the session's cost and closes it. Returns when it ended. */
  end(r: RoleRun, baseCost: number, lines: { added: number; removed: number }): number {
    const usd = this.cost(baseCost);
    r.main.endTurn(r.startedAt, usd);
    const at = r.main.t;
    r.s.push(at, "cost.snapshot", `cost:${r.s.sessionId}:${usd}`, {
      totalCostUsd: usd,
      linesAdded: lines.added,
      linesRemoved: lines.removed,
    });
    r.s.push(at + 300, "session.ended", keys.sessionEnded(r.s.sessionId), { reason: "exit" });
    this.costs.push({ at, usd });
    return Math.round(at + 300);
  }

  checkRan(at: number, checkId: string, runId: string, durationMs: number, output: string) {
    this.emit(at, "check.ran", keys.checkRan(this.squadId, checkId, runId), {
      checkId,
      runId,
      ok: true,
      durationMs,
      outputPreview: output,
    });
  }

  /** The task's own check, then Gravita commits its changes. Returns [time, sha]. */
  commit(at: number, taskId: string, attempt: number): [number, string] {
    const t = task(taskId);
    let now = at;
    this.task(now, taskId, "review", attempt);
    now += 500;
    this.checkRan(now, "typecheck", `${taskId}-${attempt}`, this.rng.int(3_000, 6_000), "0 errors");
    now += 200;
    const sha = this.sha();
    this.emit(now, "commit.created", keys.commit(this.squadId, sha), {
      role: t.role,
      taskId,
      sha,
      files: t.writes,
    });
    return [now, sha];
  }

  /** Merges a committed task into the integration branch and runs the integration checks. */
  merge(at: number, taskId: string, attempt: number): number {
    const role = task(taskId).role;
    const ref = { taskId, role, attempt };
    let now = at + 200;
    this.emit(now, "merge.started", keys.merge(this.squadId, taskId, attempt, "started"), ref);
    now += 600;
    this.emit(now, "merge.succeeded", keys.merge(this.squadId, taskId, attempt, "succeeded"), {
      ...ref,
      sha: this.sha(),
    });
    const run = `${taskId}-${attempt}`;
    now += 700;
    this.checkRan(now, "unit", run, this.rng.int(4_000, 9_000), "✓ all tests passed");
    now += 500;
    this.checkRan(now, "build", run, this.rng.int(5_000, 12_000), "✓ built");
    now += 200;
    this.task(now, taskId, "done", attempt);
    return now;
  }

  /** Commit, merge, checks, done. */
  land(at: number, taskId: string, attempt = 1): number {
    const [now] = this.commit(at, taskId, attempt);
    return this.merge(now, taskId, attempt);
  }

  /** Emits `budget.warned` when the sessions' costs, in time order, cross 75% of the budget. */
  budgetWarning() {
    let used = 0;
    for (const c of [...this.costs].sort((a, b) => a.at - b.at)) {
      used += c.usd;
      if (used >= SQUAD_BUDGET_USD * 0.75) {
        this.emit(
          c.at + 100,
          "budget.warned",
          keys.budget(this.squadId, "squad", this.squadId, "warned"),
          {
            scope: "squad",
            scopeId: this.squadId,
            usedUsd: round2(used),
            limitUsd: SQUAD_BUDGET_USD,
          },
        );
        return;
      }
    }
  }

  /** Squad facts first, then each session's events, all sorted by time (stable). */
  sorted(): Timed[] {
    return [...this.facts, ...this.scripts.flatMap((s) => s.events)]
      .map((t, i) => ({ t, i }))
      .sort((a, b) => a.t.at - b.t.at || a.i - b.i)
      .map(({ t }) => t);
  }
}

// Tool helpers: paths are relative to the role's worktree. Role sessions get a shorter
// model gap than the chat stories, so a whole squad fits in about two minutes.
const GAP = 700;
const write = (r: RoleRun, path: string, lines: number, ms = 500) =>
  r.main.tool(
    "Write",
    { file_path: `${r.wt}/${path}`, content: "…" },
    { ms, gap: GAP, changes: [{ path: `${r.wt}/${path}`, added: lines, removed: 0 }] },
  );
const edit = (r: RoleRun, path: string, added: number, removed: number) =>
  r.main.tool(
    "Edit",
    { file_path: `${r.wt}/${path}`, old_string: "…", new_string: "…" },
    { ms: 500, gap: GAP, changes: [{ path: `${r.wt}/${path}`, added, removed }] },
  );
const read = (r: RoleRun, path: string, output?: string) =>
  r.main.tool(
    "Read",
    { file_path: `${r.wt}/${path}` },
    { ms: 450, gap: GAP, ...(output ? { output } : {}) },
  );
const bash = (r: RoleRun, command: string, description: string, output: string, ms: number) =>
  r.main.tool("Bash", { command, description }, { ms: ms * 0.7, gap: GAP, output });

const taskPrompt = (taskId: string) => {
  const t = task(taskId);
  return `Task ${t.id}: ${t.title}. ${t.plainSummary} Change only: ${t.writes.join(", ")}. Done when: ${t.acceptance.join("; ")}.`;
};

/**
 * One squad run, from `squad.created` to the deliver phase. The first cycle stops there,
 * waiting for the user; later cycles deliver as a branch after a pause. The next squad
 * starts after the idle gap.
 */
export function squadRun(
  seed: number,
  cycle: number,
  at: number,
): { events: Timed[]; next: number } {
  const q = new SquadRun(seed, cycle);
  const sq = q.squadId;

  q.emit(at, "squad.created", keys.squadCreated(sq), {
    cwd: TODO.root,
    brief: SQUAD_BRIEF,
    models: { planner: "opus", roles: "opus" },
    budgetUsd: SQUAD_BUDGET_USD,
    autonomy: "guarded",
    baseBranch: "main",
  });
  q.phase(at + 100, "planning");

  // Planning: read the repo, send an Explore, propose; the first plan is rejected.
  const pl = q.session(at + 300, "planner", {
    title: "Planner: plan the squad",
    prompt: `Plan a squad for this brief. Answer with a SquadPlan. Brief: ${SQUAD_BRIEF}`,
  });
  pl.main
    .think(1_200)
    .say(
      "I'll look at the repo first, then split the work into roles that never share a file.",
      800,
    )
    .tool(
      "Glob",
      { pattern: "**/*", path: pl.wt },
      { ms: 400, output: "README.md package.json .gitignore" },
    );
  read(pl, "README.md", "# todo-app");
  read(pl, "package.json", '{ "name": "todo-app", "private": true }');
  const survey = pl.main.spawn(
    "Explore",
    "Survey the repo",
    "Check for workspaces, scripts and CI config.",
    { background: false, model: HAIKU },
  );
  survey
    .think(500)
    .tool("Glob", { pattern: ".github/**", path: pl.wt }, { ms: 400, output: "No files found" })
    .tool(
      "Grep",
      { pattern: "workspaces|pnpm-workspace", path: pl.wt },
      { ms: 500, output: "No matches" },
    )
    .say("The repo is empty: no workspaces and no CI yet.", 500)
    .finish("Empty repo: README.md and a root package.json, no workspaces, no CI.");
  pl.main.say(
    "Three roles: backend with the contract, frontend, and tests. Writing the plan.",
    900,
  );
  const firstAt = Math.round(pl.main.t);
  q.emit(firstAt, "plan.proposed", keys.planProposed(sq, 1), { attempt: 1, plan: FIRST_PROPOSAL });
  q.emit(firstAt + 300, "plan.rejected", keys.planRejected(sq, 1), {
    attempt: 1,
    errors: FIRST_PROPOSAL_ERRORS,
  });
  pl.main.t = firstAt + 600;
  pl.s.userPrompt(
    pl.main.t,
    `The plan is not valid:\n- ${FIRST_PROPOSAL_ERRORS.join("\n- ")}\nFix it and answer again.`,
    "gravita",
  );
  pl.main
    .wait(300)
    .think(900)
    .say("API tests move to a top-level tests/ folder, so tests owns tests/ and e2e/ only.", 800);
  const secondAt = Math.round(pl.main.t);
  q.emit(secondAt, "plan.proposed", keys.planProposed(sq, 2), {
    attempt: 2,
    plan: SAMPLE_SQUAD_PLAN,
  });
  q.phase(secondAt + 200, "review", "Waiting for your approval");
  const planned = q.end(pl, 2.0, { added: 0, removed: 0 });

  // Review: the user reads the plan, then approves it.
  const approvedAt = Math.max(planned, secondAt + 200) + REVIEW_MS;
  q.emit(approvedAt, "plan.approved", keys.planApproved(sq), { plan: SAMPLE_SQUAD_PLAN });
  q.phase(approvedAt + 200, "foundation");

  // Foundation: the backend scaffolds the API, then writes and freezes the contract.
  let t = approvedAt + 400;
  q.task(t, "scaffold-api", "ready", 1);
  const scaffold = q.run(t + 200, "scaffold-api", 1, taskPrompt("scaffold-api"));
  scaffold.main.think(800).say("Setting up a Hono server with a health check.", 600);
  write(scaffold, "apps/api/package.json", 24);
  write(scaffold, "apps/api/tsconfig.json", 12);
  write(scaffold, "apps/api/src/index.ts", 18);
  scaffold.main.tool(
    "Bash",
    { command: "pnpm add hono @hono/node-server", description: "Install Hono" },
    {
      ms: 2_600,
      output: "+ hono 4.9.2\n+ @hono/node-server 1.14.0",
      permission: { waitMs: 6_000 },
    },
  );
  bash(scaffold, "pnpm -C apps/api typecheck", "Typecheck the API", "0 errors", 1_800);
  scaffold.main.say("The API starts and GET /health answers 200.", 500);
  t = q.land(q.end(scaffold, 1.1, { added: 54, removed: 0 }), "scaffold-api");

  q.task(t, "contracts", "ready", 1);
  const contract = q.run(t + 200, "contracts", 1, taskPrompt("contracts"));
  contract.main.think(900).say("Writing the /todos contract, then generating its types.", 600);
  write(contract, "packages/contracts/openapi.yaml", 96, 700);
  write(contract, "packages/contracts/package.json", 16);
  bash(
    contract,
    "pnpm -C packages/contracts generate",
    "Generate types from openapi.yaml",
    "✓ src/types.ts (Todo, NewTodo, TodoPatch)",
    2_000,
  );
  write(contract, "packages/contracts/src/index.ts", 4);
  bash(contract, "pnpm -C packages/contracts lint", "Lint the contract", "✓ valid", 1_400);
  contract.main.say("Contract v1: GET, POST /todos; PATCH, DELETE /todos/{id}.", 500);
  const [committed, contractSha] = q.commit(
    q.end(contract, 1.4, { added: 172, removed: 0 }),
    "contracts",
    1,
  );
  t = q.merge(committed, "contracts", 1);
  q.emit(
    t + 200,
    "contract.frozen",
    keys.contractFrozen(sq, "packages/contracts/openapi.yaml", 1),
    { path: "packages/contracts/openapi.yaml", version: 1, sha: contractSha },
  );
  const build = t + 400;
  q.phase(build, "build");
  for (const id of ["api-store", "web-shell", "web-client", "tests-api"]) {
    q.task(build + 100, id, "ready", 1);
  }

  // Backend lane: storage, then routes (whose first merge conflicts).
  const store = q.run(build + 300, "api-store", 1, taskPrompt("api-store"));
  store.main.think(900);
  read(store, "apps/api/src/index.ts");
  write(store, "apps/api/src/db/schema.sql", 12);
  write(store, "apps/api/src/db/client.ts", 38);
  write(store, "apps/api/src/db/todos.ts", 64);
  bash(store, "pnpm -C apps/api test db", "Run the storage tests", "✓ 6 tests passed", 2_400);
  store.main.say("Todos live in data/todos.db; migrations run on start.", 500);
  const storeDone = q.land(q.end(store, 1.8, { added: 114, removed: 0 }), "api-store");

  q.task(storeDone, "api-routes", "ready", 1);
  const routes = q.run(storeDone + 200, "api-routes", 1, taskPrompt("api-routes"));
  routes.main.think(900);
  read(routes, "packages/contracts/openapi.yaml");
  const cors = routes.main.spawn(
    "Explore",
    "Check Hono CORS",
    "How does Hono's cors() middleware restrict origins?",
    { background: false, model: HAIKU },
  );
  cors
    .think(500)
    .tool(
      "Grep",
      { pattern: "export const cors", path: `${routes.wt}/node_modules/hono/dist` },
      { ms: 600, output: "dist/middleware/cors/index.js" },
    )
    .say("cors({ origin }) takes a string, a list or a function.", 500)
    .finish("Use cors({ origin: 'http://localhost:5173' }) on /todos/*.");
  routes.main.say(
    "Frontend asked for CORS from the Vite dev server; adding it with the routes.",
    600,
  );
  write(routes, "apps/api/src/routes/todos.ts", 88, 700);
  write(routes, "apps/api/src/app.ts", 26);
  edit(routes, "apps/api/src/index.ts", 3, 8);
  bash(routes, "pnpm -C apps/api test", "Run the API tests", "✓ 14 tests passed", 2_600);
  routes.main.say("All four routes follow the contract; bad input answers 400.", 500);
  const [routesCommitted] = q.commit(
    q.end(routes, 2.5, { added: 117, removed: 8 }),
    "api-routes",
    1,
  );
  q.emit(routesCommitted + 300, "merge.started", keys.merge(sq, "api-routes", 1, "started"), {
    taskId: "api-routes",
    role: "backend",
    attempt: 1,
  });
  q.emit(
    routesCommitted + 1_200,
    "merge.conflicted",
    keys.merge(sq, "api-routes", 1, "conflicted"),
    {
      taskId: "api-routes",
      role: "backend",
      attempt: 1,
      paths: ["apps/api/src/app.ts"],
    },
  );
  const resolve = q.run(
    routesCommitted + 1_600,
    "api-routes",
    2,
    "Your merge into the integration branch conflicts in apps/api/src/app.ts. Merge gravita/integration into your branch, keep both sides, and run the tests.",
    "Merge conflict in apps/api/src/app.ts",
  );
  resolve.main.think(700);
  bash(
    resolve,
    `git merge gravita/${sq}/integration`,
    "Merge the integration branch",
    "CONFLICT (content): Merge conflict in apps/api/src/app.ts",
    1_200,
  );
  read(resolve, "apps/api/src/app.ts");
  edit(resolve, "apps/api/src/app.ts", 4, 9);
  bash(resolve, "pnpm -C apps/api test", "Run the API tests", "✓ 14 tests passed", 2_400);
  resolve.main.say("Conflict resolved: both the logger and the CORS middleware stay.", 500);
  const routesDone = q.land(q.end(resolve, 0.8, { added: 4, removed: 9 }), "api-routes", 2);
  q.emit(routesDone + 200, "change_request.resolved", keys.changeRequest(sq, "cr-1", "resolved"), {
    requestId: "cr-1",
    outcome: "done",
  });

  // Frontend lane: shell (asks backend for CORS), client (steps outside its paths), list UI.
  const shell = q.run(build + 300, "web-shell", 1, taskPrompt("web-shell"));
  shell.main.think(800);
  write(shell, "apps/web/package.json", 22);
  write(shell, "apps/web/index.html", 14);
  write(shell, "apps/web/vite.config.ts", 16);
  q.emit(shell.main.t, "change_request.opened", keys.changeRequest(sq, "cr-1", "opened"), {
    requestId: "cr-1",
    fromRole: "frontend",
    toRole: "backend",
    text: "Please allow CORS from http://localhost:5173 so the Vite dev server can call the API.",
  });
  shell.main.say("Asked the backend for CORS; the dev server proxies /todos meanwhile.", 500);
  write(shell, "apps/web/src/main.tsx", 12);
  write(shell, "apps/web/src/App.tsx", 20);
  bash(shell, "pnpm -C apps/web build", "Build the web app", "✓ built in 1.4s", 2_000);
  const shellDone = q.land(q.end(shell, 1.5, { added: 84, removed: 0 }), "web-shell");

  const client = q.run(shellDone + 200, "web-client", 1, taskPrompt("web-client"));
  client.main.think(800);
  read(client, "packages/contracts/src/index.ts");
  read(
    client,
    "apps/api/src/types.ts",
    "export interface Todo { id: string; title: string; done: boolean }",
  );
  client.main.say(
    "The API's Todo says done, the contract says completed. Aligning the API type.",
    600,
  );
  edit(client, "apps/api/src/types.ts", 1, 1);
  write(client, "apps/web/src/api/client.ts", 46);
  const clientCommitAt = q.end(client, 1.8, { added: 47, removed: 1 });
  q.task(clientCommitAt, "web-client", "review", 1);
  q.emit(
    clientCommitAt + 500,
    "ownership.violation",
    keys.ownershipViolation(sq, "web-client", 1),
    {
      role: "frontend",
      taskId: "web-client",
      attempt: 1,
      paths: ["apps/api/src/types.ts"],
    },
  );
  const fix = q.run(
    clientCommitAt + 900,
    "web-client",
    2,
    "Your changes touched apps/api/src/types.ts, which the backend role owns. Undo that change and use the Todo type from packages/contracts. If the API must change, post a note to backend.",
    "Changed apps/api/src/types.ts, which backend owns",
  );
  fix.main.think(700);
  bash(fix, "git checkout -- apps/api/src/types.ts", "Undo the API change", "", 600);
  edit(fix, "apps/web/src/api/client.ts", 3, 3);
  q.emit(fix.main.t, "note.posted", keys.note(sq, "n-1"), {
    noteId: "n-1",
    fromRole: "frontend",
    toRole: "backend",
    text: "apps/api/src/types.ts still calls the field done; the contract says completed. The web client uses the contract's Todo.",
  });
  bash(fix, "pnpm -C apps/web typecheck", "Typecheck the web app", "0 errors", 1_400);
  fix.main.say("The client now imports Todo from the contract; the API is untouched.", 500);
  const clientDone = q.land(q.end(fix, 1.0, { added: 3, removed: 3 }), "web-client", 2);

  q.task(clientDone, "web-todos", "ready", 1);
  const list = q.run(clientDone + 200, "web-todos", 1, taskPrompt("web-todos"));
  list.main.think(900).todo([
    { content: "TodoList and TodoItem components", status: "in_progress" },
    { content: "Add, complete and delete", status: "pending" },
    { content: "Empty state and styles", status: "pending" },
  ]);
  write(list, "apps/web/src/components/TodoList.tsx", 58, 700);
  write(list, "apps/web/src/components/TodoItem.tsx", 41);
  write(list, "apps/web/src/components/NewTodo.tsx", 34);
  edit(list, "apps/web/src/App.tsx", 12, 6);
  write(list, "apps/web/src/styles.css", 48);
  bash(list, "pnpm -C apps/web test", "Run the component tests", "✓ 9 tests passed", 2_200);
  list.main.say("The list adds, ticks off and deletes todos, with an empty state.", 500);
  const listDone = q.land(q.end(list, 2.8, { added: 193, removed: 6 }), "web-todos");

  // Tests lane: API tests against the contract, then the browser tests once both sides land.
  const apiTests = q.run(build + 300, "tests-api", 1, taskPrompt("tests-api"));
  apiTests.main.think(900);
  read(apiTests, "packages/contracts/openapi.yaml");
  write(apiTests, "tests/vitest.config.ts", 10);
  write(apiTests, "tests/api/todos.test.ts", 112, 800);
  write(apiTests, "tests/api/errors.test.ts", 46);
  bash(
    apiTests,
    "pnpm vitest run --config tests/vitest.config.ts",
    "Run the API tests",
    "✓ 18 tests passed",
    3_000,
  );
  apiTests.main.say("Every route and error case in the contract has a test.", 500);
  q.land(q.end(apiTests, 1.9, { added: 168, removed: 0 }), "tests-api");

  const e2eReady = Math.max(routesDone, listDone) + 200;
  q.task(e2eReady, "tests-e2e", "ready", 1);
  const e2e = q.run(e2eReady + 200, "tests-e2e", 1, taskPrompt("tests-e2e"));
  e2e.main.think(900);
  read(e2e, "apps/web/src/components/TodoList.tsx");
  write(e2e, "e2e/playwright.config.ts", 18);
  write(e2e, "e2e/todos.spec.ts", 74, 700);
  bash(e2e, "pnpm exec playwright test", "Run the browser tests", "✓ 5 passed (chromium)", 4_200);
  e2e.main.say("Add, complete and delete pass in Chromium.", 500);
  const e2eDone = q.land(q.end(e2e, 2.3, { added: 92, removed: 0 }), "tests-e2e");

  // Verify: the tests role runs the final checks on the integration branch.
  const verifyAt = e2eDone + 400;
  q.phase(verifyAt, "verify");
  const verify = q.session(verifyAt + 200, "tests", {
    title: "Tests: final checks",
    prompt: "Every task has landed. Run the final checks on the integration branch and report.",
  });
  verify.main.think(700);
  for (const [checkId, command, output, ms] of [
    ["unit", "pnpm -r test", "✓ 47 tests passed", 3_600],
    ["build", "pnpm -r build", "✓ 3 packages built", 3_000],
    ["e2e", "pnpm exec playwright test", "✓ 5 passed (chromium)", 4_400],
  ] as const) {
    bash(verify, command, `Final check: ${checkId}`, output, ms);
    q.checkRan(verify.main.t, checkId, "final", Math.round(ms * 1.1), output);
  }
  verify.main.say("All final checks pass: 47 tests, 3 builds, 5 browser tests.", 500);
  const verified = q.end(verify, 1.1, { added: 0, removed: 0 });
  const deliverAt = verified + 300;
  q.phase(deliverAt, "deliver", "Ready to deliver");
  q.budgetWarning();

  let end = deliverAt;
  if (cycle > 0) {
    end = deliverAt + DELIVER_WAIT_MS;
    q.emit(end, "squad.delivered", keys.squadDelivered(sq), {
      mode: "branch",
      ref: `gravita/${sq}/integration`,
    });
    q.phase(end + 100, "done");
    end += 100;
  }
  return { events: q.sorted(), next: Math.round(end + IDLE_BETWEEN_SESSIONS_MS) };
}

/** Squads one after another in the todo-app project, forever. */
export function* squadSessions(seed: number, startAt: number): Generator<Timed, never> {
  let at = startAt;
  for (let cycle = 0; ; cycle++) {
    const { events, next } = squadRun(seed, cycle, at);
    yield* events;
    at = next;
  }
}
