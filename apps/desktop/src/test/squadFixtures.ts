import type { GravitaState } from "@gravita/core";
import type {
  ConversationMessage,
  GravitaEvent,
  PlanTask,
  SquadPhase,
  SquadPlan,
  TaskStatus,
} from "@gravita/protocol";
import { ago, ev, stateOf } from "./events";

// Squads in every phase, built with the same reducer the engine and the UI use. Tests
// render them; the dev-only gallery shows them (never in a production bundle).

export const SQ = "sq-demo";
export const PROJECT = "p1";
const at = (minutes: number, sessionId?: string, agentId?: string) => ({
  ts: ago(minutes),
  projectId: PROJECT,
  ...(sessionId ? { sessionId } : {}),
  ...(agentId ? { agentId } : {}),
});

const task = (
  id: string,
  role: string,
  title: string,
  plainSummary: string,
  writes: string[],
  dependsOn: string[] = [],
  extra: Partial<PlanTask> = {},
): PlanTask => ({
  id,
  role,
  title,
  plainSummary,
  dependsOn,
  writes,
  acceptance: ["It works end to end", "The checks pass"],
  size: "m",
  ...extra,
});

export const PLAN: SquadPlan = {
  goal: "A small todo app: Hono API, React web UI, Vitest tests",
  summary:
    "A Hono API stores todos in SQLite; a React app lists, adds, completes and deletes them. The API shape is frozen in an OpenAPI contract first, so the web client and the tests build against it in parallel.",
  stack: ["typescript", "hono", "sqlite", "react", "vitest"],
  roles: [
    {
      id: "backend",
      name: "Backend",
      kind: "backend",
      owns: ["apps/api/", "packages/contracts/"],
      charter: "Own the API and its contract.",
    },
    {
      id: "frontend",
      name: "Frontend",
      kind: "frontend",
      owns: ["apps/web/"],
      charter: "Own the web app; ask the backend for API changes.",
    },
    {
      id: "tests",
      name: "Tests",
      kind: "tests",
      owns: ["tests/", "e2e/"],
      charter: "Test through HTTP and the browser.",
    },
  ],
  shared: { paths: ["package.json", "pnpm-lock.yaml"], strategy: "regenerate" },
  contracts: [{ path: "packages/contracts/openapi.yaml", owner: "backend", kind: "openapi" }],
  tasks: [
    task(
      "scaffold-api",
      "backend",
      "Scaffold the API",
      "Sets up an empty API server that answers a health check.",
      ["apps/api/src/index.ts"],
      [],
      { size: "s", foundation: true },
    ),
    task(
      "contracts",
      "backend",
      "Todo API contract",
      "Writes down exactly what the API accepts and returns.",
      ["packages/contracts/"],
      ["scaffold-api"],
      { size: "s", foundation: true },
    ),
    task(
      "api-store",
      "backend",
      "Todo storage",
      "Saves todos in SQLite so they survive a restart.",
      ["apps/api/src/db/"],
      ["scaffold-api"],
    ),
    task(
      "api-routes",
      "backend",
      "Todo routes",
      "Lets the app list, add, complete and delete todos.",
      ["apps/api/src/routes/"],
      ["contracts", "api-store"],
    ),
    task(
      "web-shell",
      "frontend",
      "Web app shell",
      "Creates the page the todo list lives in.",
      ["apps/web/src/App.tsx"],
      ["contracts"],
      { size: "s" },
    ),
    task(
      "web-todos",
      "frontend",
      "Todo list UI",
      "Shows the todos and lets people add, tick off and delete them.",
      ["apps/web/src/components/"],
      ["web-shell"],
    ),
    task(
      "tests-api",
      "tests",
      "API tests",
      "Checks every API route against the contract.",
      ["tests/api/"],
      ["contracts"],
    ),
    task(
      "tests-e2e",
      "tests",
      "End-to-end tests",
      "Clicks through the app in a real browser.",
      ["e2e/"],
      ["api-routes", "web-todos"],
    ),
  ],
  checks: [
    { id: "typecheck", argv: ["pnpm", "-r", "typecheck"], cwd: ".", when: "task" },
    { id: "unit", argv: ["pnpm", "-r", "test"], cwd: ".", when: "integration" },
    { id: "e2e", argv: ["pnpm", "exec", "playwright", "test"], cwd: ".", when: "final" },
  ],
  assumptions: ["No sign-in: one shared list.", "SQLite in a local file is enough."],
  questions: ["Should completed todos stay visible, or move to a separate list?"],
};

const squadEvent = <T extends GravitaEvent["type"]>(
  type: T,
  data: Omit<Extract<GravitaEvent, { type: T }>["data"], "squadId">,
  minutes: number,
) => ev(type as GravitaEvent["type"], { squadId: SQ, ...data } as never, at(minutes));

function created(): GravitaEvent[] {
  return [
    ev("project.discovered", { root: "/work/todo", name: "todo-app" }, at(60)),
    squadEvent(
      "squad.created",
      {
        cwd: "/work/todo",
        brief: "Build a small todo app: API with Hono, web UI with React, tests with Vitest.",
        models: { planner: "opus", roles: "sonnet" },
        budgetUsd: 25,
        autonomy: "guarded",
        baseBranch: "main",
      },
      60,
    ),
  ];
}

/** A role (or planner) session, Gravita-run, with its main agent doing something. */
function roleSession(
  sessionId: string,
  roleId: string,
  minutes: number,
  extra: { taskId?: string; costUsd?: number; doing?: "edit" | "think" | "ask" | "done" } = {},
): GravitaEvent[] {
  const out: GravitaEvent[] = [
    ev(
      "session.started",
      {
        kind: "squad",
        cwd: `/work/todo/.wt/${roleId}`,
        squadId: SQ,
        roleId,
        ...(extra.taskId ? { taskId: extra.taskId } : {}),
      },
      at(minutes, sessionId),
    ),
    ev("session.control", { controllable: true }, at(minutes, sessionId)),
    ev(
      "message.user",
      { uuid: `${sessionId}-u`, textPreview: "Your task", origin: "gravita" },
      at(minutes, sessionId, "main"),
    ),
  ];
  const doing = extra.doing ?? "think";
  if (doing === "edit")
    out.push(
      ev(
        "tool.started",
        {
          toolUseId: `${sessionId}-t`,
          name: "Edit",
          kind: "edit",
          target: { path: "apps/web/src/App.tsx" },
          inputPreview: "App.tsx",
        },
        at(0.2, sessionId, "main"),
      ),
    );
  if (doing === "ask")
    out.push(
      ev(
        "permission.requested",
        { requestId: `${sessionId}-r`, toolName: "Bash", inputPreview: "pnpm add hono" },
        at(0.2, sessionId, "main"),
      ),
    );
  if (doing === "done")
    out.push(
      ev("turn.completed", {}, at(minutes - 1, sessionId, "main")),
      ev("session.ended", { reason: "exit" }, at(minutes - 1, sessionId)),
    );
  if (extra.costUsd !== undefined)
    out.push(ev("cost.snapshot", { totalCostUsd: extra.costUsd }, at(0.5, sessionId)));
  return out;
}

const phase = (p: SquadPhase, minutes: number, reason?: string) =>
  squadEvent("squad.phase_changed", { phase: p, ...(reason ? { reason } : {}) }, minutes);

const status = (
  taskId: string,
  s: TaskStatus,
  minutes: number,
  extra: { attempt?: number; sessionId?: string; reason?: string } = {},
) => {
  const t = PLAN.tasks.find((x) => x.id === taskId);
  return squadEvent(
    "task.status_changed",
    {
      taskId,
      status: s,
      attempt: extra.attempt ?? 1,
      role: t?.role ?? "backend",
      ...(extra.sessionId ? { sessionId: extra.sessionId } : {}),
      ...(extra.reason ? { reason: extra.reason } : {}),
    },
    minutes,
  );
};

const merged = (taskId: string, minutes: number) => {
  const role = PLAN.tasks.find((x) => x.id === taskId)?.role ?? "backend";
  return [
    squadEvent(
      "commit.created",
      {
        role,
        taskId,
        sha: `${taskId}`.padEnd(40, "a"),
        files: PLAN.tasks.find((x) => x.id === taskId)?.writes ?? [],
      },
      minutes,
    ),
    squadEvent("merge.started", { taskId, role, attempt: 1 }, minutes),
    squadEvent("merge.succeeded", { taskId, role, attempt: 1, sha: "b".repeat(40) }, minutes),
  ];
};

export type SquadFixture = "brief" | "planning" | "review" | "run" | "budget" | "deliver" | "dense";

export interface FixtureData {
  state: GravitaState;
  /** What the planner's conversation shows, for the brief. */
  conversation: ConversationMessage[];
}

export const PLANNER_SESSION = "s-planner";

export function squadFixture(kind: SquadFixture): FixtureData {
  const brief = [
    ...created(),
    ...roleSession(PLANNER_SESSION, "planner", 58, { costUsd: 0.4 }),
    ev("turn.completed", {}, at(55, PLANNER_SESSION, "main")),
  ];
  const conversation: ConversationMessage[] = [
    {
      uuid: "m1",
      role: "user",
      ts: ago(58),
      text: "Build a small todo app: API with Hono, web UI with React, tests with Vitest.",
    },
    {
      uuid: "m2",
      role: "assistant",
      ts: ago(57),
      text: "I read the repository: it's empty apart from a README. Two questions before I plan: should todos persist across restarts, and do you want end-to-end tests in a real browser?",
    },
    {
      uuid: "m3",
      role: "user",
      ts: ago(56),
      text: "Yes, persist them in SQLite. And yes to browser tests.",
    },
    {
      uuid: "m4",
      role: "assistant",
      ts: ago(55),
      text: "Then I'd use three roles: backend owns the API and an OpenAPI contract, frontend owns the web app, tests owns the API and browser tests. Ready to write the plan when you are.",
    },
  ];
  if (kind === "brief") return { state: stateOf(brief), conversation };

  const planning = [
    ...brief,
    phase("planning", 54),
    squadEvent(
      "plan.rejected",
      {
        attempt: 1,
        errors: [
          'Roles "backend" and "tests" overlap: "apps/api/" and "apps/api/test/"; each path needs a single owner.',
        ],
      },
      53,
    ),
  ];
  if (kind === "planning") return { state: stateOf(planning), conversation };

  const review = [
    ...planning,
    squadEvent("plan.proposed", { attempt: 2, plan: PLAN }, 52),
    phase("review", 52, "Waiting for your approval"),
  ];
  if (kind === "review") return { state: stateOf(review), conversation };

  const approved = [
    ...review,
    squadEvent("plan.approved", { plan: PLAN, answers: {} }, 50),
    ev("turn.completed", {}, at(50, PLANNER_SESSION, "main")),
    phase("foundation", 50),
  ];

  if (kind === "dense") return { state: stateOf(dense()), conversation };

  const run = [
    ...approved,
    ...roleSession("s-b1", "backend", 49, { taskId: "scaffold-api", costUsd: 1.1, doing: "done" }),
    status("scaffold-api", "running", 49, { sessionId: "s-b1" }),
    status("scaffold-api", "done", 45),
    ...merged("scaffold-api", 45),
    status("contracts", "done", 40),
    ...merged("contracts", 40),
    squadEvent(
      "contract.frozen",
      { path: "packages/contracts/openapi.yaml", version: 1, sha: "c".repeat(40) },
      40,
    ),
    phase("build", 40),
    ...roleSession("s-b2", "backend", 39, { taskId: "api-store", costUsd: 2.6 }),
    status("api-store", "running", 39, { sessionId: "s-b2" }),
    ...roleSession("s-f1", "frontend", 38, { taskId: "web-shell", costUsd: 1.9, doing: "edit" }),
    status("web-shell", "done", 30),
    ...merged("web-shell", 30),
    status("web-todos", "running", 29, { sessionId: "s-f1" }),
    ...roleSession("s-t1", "tests", 38, { taskId: "tests-api", costUsd: 2.2, doing: "done" }),
    squadEvent(
      "ownership.violation",
      { role: "tests", taskId: "tests-api", attempt: 1, paths: ["apps/api/src/app.ts"] },
      33,
    ),
    squadEvent("merge.started", { taskId: "tests-api", role: "tests", attempt: 2 }, 31),
    squadEvent(
      "merge.conflicted",
      { taskId: "tests-api", role: "tests", attempt: 2, paths: ["tests/api/todos.test.ts"] },
      31,
    ),
    status("tests-api", "blocked", 30, {
      attempt: 2,
      reason:
        "Merging into integration conflicted in tests/api/todos.test.ts; the next run starts from integration.",
    }),
    squadEvent(
      "check.ran",
      {
        checkId: "unit",
        runId: "u1",
        ok: false,
        durationMs: 4200,
        outputPreview: "FAIL tests/api/todos.test.ts > POST /todos\n  expected 201, got 400",
      },
      30,
    ),
    squadEvent(
      "change_request.opened",
      {
        requestId: "cr-1",
        fromRole: "frontend",
        toRole: "backend",
        text: "Please return the created todo from POST /todos so the list can update without a refetch.",
        taskId: "api-routes",
      },
      28,
    ),
    squadEvent(
      "note.posted",
      {
        noteId: "n-1",
        fromRole: "backend",
        text: "The contract is frozen at v1; build against packages/contracts.",
      },
      39,
    ),
  ];
  if (kind === "run") return { state: stateOf(run), conversation };

  if (kind === "budget") {
    return {
      state: stateOf([
        ...run,
        squadEvent(
          "budget.exhausted",
          { scope: "squad", scopeId: SQ, usedUsd: 25.1, limitUsd: 25 },
          2,
        ),
        squadEvent("squad.paused", { reason: "The squad's budget ($25.00) is used up." }, 2),
      ]),
      conversation,
    };
  }

  // deliver
  const all = PLAN.tasks.map((t) => t.id);
  return {
    state: stateOf([
      ...approved,
      ...roleSession("s-b1", "backend", 49, { costUsd: 6.2, doing: "done" }),
      ...roleSession("s-f1", "frontend", 45, { costUsd: 4.8, doing: "done" }),
      ...roleSession("s-t1", "tests", 45, { costUsd: 3.9, doing: "done" }),
      phase("build", 40),
      ...all.flatMap((id, i) => [status(id, "done", 30 - i), ...merged(id, 30 - i)]),
      phase("verify", 12),
      squadEvent("check.ran", { checkId: "e2e", runId: "f1", ok: true, durationMs: 31_400 }, 10),
      squadEvent("check.ran", { checkId: "unit", runId: "f2", ok: true, durationMs: 6_100 }, 10),
      phase("deliver", 9, "Ready to deliver"),
    ]),
    conversation,
  };
}

/** Six roles, forty tasks: how the Board and the map hold up at the content range's top. */
function dense(): GravitaEvent[] {
  const kinds = ["backend", "frontend", "design", "tests", "custom", "custom"] as const;
  const names = ["Backend", "Frontend", "Design", "Tests", "Docs", "Infra"];
  const ids = ["backend", "frontend", "design", "tests", "docs", "infra"];
  const plan: SquadPlan = {
    ...PLAN,
    roles: ids.map((id, i) => ({
      id,
      name: names[i] ?? id,
      kind: kinds[i] ?? "custom",
      owns: [`${id}/`],
      charter: `Own ${id}.`,
    })),
    tasks: Array.from({ length: 40 }, (_, i) => {
      const role = ids[i % ids.length] ?? "backend";
      return task(
        `t${i}`,
        role,
        `${names[i % names.length]} task ${i + 1}`,
        "One slice of the work, in plain words.",
        [`${role}/part-${i}/`],
        i >= 6 ? [`t${i - 6}`] : [],
        { size: (["s", "m", "l"] as const)[i % 3] ?? "m", ...(i < 2 ? { foundation: true } : {}) },
      );
    }),
    checks: PLAN.checks,
    questions: [],
  };
  const events: GravitaEvent[] = [
    ...created(),
    squadEvent("plan.proposed", { attempt: 1, plan }, 52),
    squadEvent("plan.approved", { plan }, 50),
    phase("build", 40),
  ];
  plan.tasks.forEach((t, i) => {
    if (i < 18) events.push(status(t.id, "done", 30), ...merged(t.id, 30));
    else if (i < 22)
      events.push(
        status(t.id, i === 20 ? "blocked" : i === 21 ? "failed" : "running", 10, {
          ...(i === 21 ? { reason: "The typecheck failed twice." } : {}),
        }),
      );
  });
  return events.map((e) =>
    e.type === "task.status_changed" || e.type.startsWith("merge.") || e.type === "commit.created"
      ? ({
          ...e,
          data: {
            ...e.data,
            role:
              plan.tasks.find((t) => t.id === (e.data as { taskId: string }).taskId)?.role ??
              "backend",
          },
        } as GravitaEvent)
      : e,
  );
}
