import type { SquadPlan } from "@gravita/protocol";

/** A small valid plan: a planner, backend and frontend, one foundation task. */
export function samplePlan(): SquadPlan {
  return {
    goal: "A todo app",
    summary: "An API and a web UI for todos.",
    stack: ["hono", "react", "vitest"],
    roles: [
      { id: "planner", name: "Planner", kind: "planner", owns: ["docs/plan/"], charter: "Plan." },
      { id: "backend", name: "Backend", kind: "backend", owns: ["apps/api/"], charter: "API." },
      {
        id: "frontend",
        name: "Frontend",
        kind: "frontend",
        owns: ["apps/web/", "packages/ui"],
        charter: "UI.",
      },
    ],
    shared: { paths: ["package.json", "pnpm-lock.yaml"], strategy: "regenerate" },
    contracts: [{ path: "apps/api/openapi.yaml", owner: "backend", kind: "openapi" }],
    tasks: [
      {
        id: "api-contract",
        role: "backend",
        title: "API contract",
        plainSummary: "Agrees on what the API looks like.",
        dependsOn: [],
        writes: ["apps/api/openapi.yaml"],
        acceptance: ["The contract lists /todos"],
        size: "s",
        foundation: true,
      },
      {
        id: "api-todos",
        role: "backend",
        title: "Todos API",
        plainSummary: "Lets the app save and list todos.",
        dependsOn: ["api-contract"],
        writes: ["apps/api/src/"],
        acceptance: ["GET /todos lists todos"],
        size: "m",
      },
      {
        id: "web-list",
        role: "frontend",
        title: "Todo list",
        plainSummary: "Shows the todos.",
        dependsOn: ["api-contract"],
        writes: ["apps/web/src/", "packages/ui/src/list.tsx"],
        acceptance: ["The list renders"],
        size: "l",
      },
    ],
    checks: [
      { id: "api-test", argv: ["pnpm", "test"], cwd: "apps/api", when: "integration" },
      { id: "all", argv: ["pnpm", "-r", "test"], cwd: ".", when: "final" },
    ],
    assumptions: [],
    questions: [],
  };
}
