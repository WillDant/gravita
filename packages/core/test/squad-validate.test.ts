import { describe, expect, test } from "bun:test";
import type { SquadPlan } from "@gravita/protocol";
import { isWithin, outsideOwnership, ownerOf, type PlanIssue, validatePlan } from "../src";
import { samplePlan } from "./squad-fixture";

/** Clone the sample and change it. */
function plan(edit: (p: SquadPlan) => void): SquadPlan {
  const p = structuredClone(samplePlan());
  edit(p);
  return p;
}

const role = (p: SquadPlan, id: string) => p.roles.find((r) => r.id === id)!;
const task = (p: SquadPlan, id: string) => p.tasks.find((t) => t.id === id)!;

const cases: [string, SquadPlan, PlanIssue[]][] = [
  ["the sample is valid", samplePlan(), []],
  [
    "duplicate role, task and check ids",
    plan((p) => {
      p.roles.push({ ...role(p, "backend"), owns: ["apps/worker/"] });
      p.tasks.push({ ...task(p, "api-todos"), dependsOn: [] });
      p.checks.push({ ...p.checks[0]! });
    }),
    [
      { code: "duplicate_role", message: 'Role id "backend" is used more than once.' },
      { code: "duplicate_task", message: 'Task id "api-todos" is used more than once.' },
      { code: "duplicate_check", message: 'Check id "api-test" is used more than once.' },
    ],
  ],
  [
    "the integration role id is reserved",
    plan((p) => {
      p.roles.push({ ...role(p, "backend"), id: "integration", owns: ["apps/worker/"] });
    }),
    [
      {
        code: "reserved_role",
        message: 'Role id "integration" is reserved by Gravita; choose another.',
        path: "roles[3].id",
      },
    ],
  ],
  [
    "owns that nest across roles overlap (trailing slash ignored)",
    plan((p) => {
      role(p, "frontend").owns.push("apps/api/src");
    }),
    [
      {
        code: "owns_overlap",
        message:
          'Roles "backend" and "frontend" overlap: "apps/api/" and "apps/api/src"; each path needs a single owner.',
        path: "roles[2].owns[2]",
      },
    ],
  ],
  [
    "sibling prefixes don't overlap: apps/api vs apps/api-gateway",
    plan((p) => {
      p.roles.push({
        id: "gateway",
        name: "Gateway",
        kind: "custom",
        owns: ["apps/api-gateway/"],
        charter: "",
      });
    }),
    [],
  ],
  [
    "a shared path owned by a role",
    plan((p) => {
      role(p, "backend").owns.push("package.json");
    }),
    [
      {
        code: "shared_owned",
        message:
          'Role "backend" owns "package.json", which covers the shared path "package.json"; shared files belong to Gravita.',
        path: "roles[1].owns[1]",
      },
    ],
  ],
  [
    "a write outside the role's owns",
    plan((p) => {
      task(p, "api-todos").writes.push("apps/web/src/api.ts");
    }),
    [
      {
        code: "write_outside_owns",
        message:
          'Task "api-todos" writes "apps/web/src/api.ts", outside what role "backend" owns (apps/api/).',
        path: "tasks[1].writes[1]",
      },
    ],
  ],
  [
    "a task for an unknown role",
    plan((p) => {
      task(p, "web-list").role = "mobile";
    }),
    [
      {
        code: "unknown_role",
        message: 'Task "web-list" is assigned to "mobile", which is not a role in this plan.',
        path: "tasks[2].role",
      },
    ],
  ],
  [
    "a missing dependency and a self-dependency",
    plan((p) => {
      task(p, "web-list").dependsOn.push("design", "web-list");
    }),
    [
      {
        code: "unknown_dependency",
        message: 'Task "web-list" depends on "design", which is not a task in this plan.',
        path: "tasks[2].dependsOn[1]",
      },
      {
        code: "self_dependency",
        message: 'Task "web-list" depends on itself.',
        path: "tasks[2].dependsOn[2]",
      },
    ],
  ],
  [
    "a dependency cycle",
    plan((p) => {
      task(p, "api-todos").dependsOn.push("web-list");
      task(p, "web-list").dependsOn.push("api-todos");
    }),
    [
      {
        code: "dependency_cycle",
        message: "Tasks depend on each other in a loop: api-todos → web-list → api-todos.",
        path: "tasks[1].dependsOn",
      },
    ],
  ],
  [
    "a foundation task depending on a build task",
    plan((p) => {
      task(p, "api-contract").dependsOn.push("web-list");
      task(p, "web-list").dependsOn = [];
    }),
    [
      {
        code: "foundation_depends_on_build",
        message:
          'Foundation task "api-contract" depends on "web-list", a build task; foundation runs first.',
        path: "tasks[0].dependsOn[0]",
      },
    ],
  ],
  [
    "a contract outside its owner's paths",
    plan((p) => {
      p.contracts[0]!.owner = "frontend";
    }),
    [
      {
        code: "contract_outside_owner",
        message:
          'Contract "apps/api/openapi.yaml" sits outside what its owner "frontend" owns (apps/web/, packages/ui).',
        path: "contracts[0].path",
      },
    ],
  ],
  [
    "a check program that isn't allowed",
    plan((p) => {
      p.checks[0]!.argv = ["bash", "test.sh"];
    }),
    [
      {
        code: "check_program_not_allowed",
        message:
          'Check "api-test" runs "bash", which is not an allowed program (pnpm, npm, npx, yarn, bun, bunx, node, deno, tsc, vitest, jest, playwright, pytest, python, python3, uv, go, cargo, make, eslint, biome, prettier).',
        path: "checks[0].argv[0]",
      },
    ],
  ],
  [
    "a shell metacharacter in a check argument",
    plan((p) => {
      p.checks[0]!.argv = ["pnpm", "test", "&&", "rm"];
    }),
    [
      {
        code: "check_shell_metachar",
        message:
          'Check "api-test" has the argument "&&" with shell characters (; | & $ ` < > or a newline); list each argument plainly.',
        path: "checks[0].argv[2]",
      },
    ],
  ],
  [
    "an absolute path",
    plan((p) => {
      task(p, "api-todos").writes = ["/etc/passwd"];
    }),
    [
      {
        code: "path_absolute",
        message: '"/etc/passwd" is absolute; use a repo-relative path.',
        path: "tasks[1].writes[0]",
      },
    ],
  ],
  [
    "a path with ..",
    plan((p) => {
      role(p, "backend").owns = ["apps/api/../../secrets"];
    }),
    [
      {
        code: "path_parent",
        message: '"apps/api/../../secrets" leaves the repository with "..".',
        path: "roles[1].owns[0]",
      },
    ],
  ],
  [
    "backslashes and a leading ./",
    plan((p) => {
      p.shared.paths = ["config\\ci.yml"];
      p.checks[0]!.cwd = "./apps/api";
    }),
    [
      {
        code: "path_backslash",
        message: '"config\\ci.yml" uses backslashes; use "/".',
        path: "shared.paths[0]",
      },
      {
        code: "path_dot_prefix",
        message: '"./apps/api" starts with "./"; drop it.',
        path: "checks[0].cwd",
      },
    ],
  ],
  [
    "the planner has a task",
    plan((p) => {
      task(p, "web-list").role = "planner";
      task(p, "web-list").writes = ["docs/plan/x.md"];
    }),
    [
      {
        code: "planner_has_tasks",
        message: `Task "web-list" is assigned to the planner "planner"; the planner plans, it doesn't build.`,
        path: "tasks[2].role",
      },
    ],
  ],
  [
    "nobody but the planner has work",
    plan((p) => {
      p.tasks = [{ ...task(p, "api-todos"), role: "planner", dependsOn: [] }];
    }),
    [
      {
        code: "planner_has_tasks",
        message: `Task "api-todos" is assigned to the planner "planner"; the planner plans, it doesn't build.`,
        path: "tasks[0].role",
      },
      { code: "no_work", message: "No role other than the planner has a task." },
    ],
  ],
];

describe("validatePlan", () => {
  for (const [name, p, expected] of cases) {
    test(name, () => {
      expect(validatePlan(p)).toEqual(expected);
    });
  }

  test("is deterministic", () => {
    const bad = cases.flatMap(([, p]) => validatePlan(p));
    expect(cases.flatMap(([, p]) => validatePlan(p))).toEqual(bad);
  });
});

describe("ownership helpers", () => {
  const p = samplePlan();

  test("isWithin is segment-aware and ignores trailing slashes", () => {
    expect(isWithin("apps/api/src/x.ts", "apps/api/")).toBe(true);
    expect(isWithin("apps/api", "apps/api/")).toBe(true);
    expect(isWithin("apps/api-gateway/x.ts", "apps/api")).toBe(false);
    expect(isWithin("apps", "apps/api")).toBe(false);
    expect(isWithin("anything", ".")).toBe(true);
  });

  test("ownerOf finds the one writing role; shared and planner paths have none", () => {
    expect(ownerOf(p, "apps/api/src/index.ts")).toBe("backend");
    expect(ownerOf(p, "packages/ui/src/button.tsx")).toBe("frontend");
    expect(ownerOf(p, "packages/uikit/x.ts")).toBeUndefined();
    expect(ownerOf(p, "package.json")).toBeUndefined();
    expect(ownerOf(p, "docs/plan/plan.md")).toBeUndefined();
  });

  test("outsideOwnership lists what a role may not change, shared files included", () => {
    expect(
      outsideOwnership(p, "backend", [
        "apps/api/src/a.ts",
        "apps/web/src/b.tsx",
        "pnpm-lock.yaml",
        "apps/web/src/b.tsx",
      ]),
    ).toEqual(["apps/web/src/b.tsx", "pnpm-lock.yaml"]);
    expect(outsideOwnership(p, "planner", ["docs/plan/plan.md"])).toEqual(["docs/plan/plan.md"]);
    expect(outsideOwnership(p, "nobody", ["apps/api/a.ts"])).toEqual(["apps/api/a.ts"]);
  });
});
