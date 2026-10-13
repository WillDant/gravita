import type { PlanRole, SquadPlan } from "@gravita/protocol";
import { isWithin, overlaps } from "./paths";

// The rules that relate a plan's fields to each other. The zod schema in
// @gravita/protocol checks shapes; this checks meaning. The engine runs it on every
// proposal (issues go back to the planner on a retry) and the Board runs it on every
// edit, so both judge a plan the same way. Messages are plain English and stable.

export type PlanIssueCode =
  | "duplicate_role"
  | "duplicate_task"
  | "duplicate_check"
  | "unknown_role"
  | "path_absolute"
  | "path_parent"
  | "path_backslash"
  | "path_dot_prefix"
  | "owns_overlap"
  | "shared_owned"
  | "write_outside_owns"
  | "unknown_dependency"
  | "self_dependency"
  | "dependency_cycle"
  | "foundation_depends_on_build"
  | "contract_outside_owner"
  | "check_program_not_allowed"
  | "check_shell_metachar"
  | "planner_has_tasks"
  | "no_work";

export interface PlanIssue {
  code: PlanIssueCode;
  message: string;
  /** Where in the plan, e.g. "tasks[2].writes[0]", so the Board can point at it. */
  path?: string;
}

/** Programs a check may run. Argv never goes through a shell; this keeps checks legible. */
export const CHECK_PROGRAMS: ReadonlySet<string> = new Set([
  "pnpm",
  "npm",
  "npx",
  "yarn",
  "bun",
  "bunx",
  "node",
  "deno",
  "tsc",
  "vitest",
  "jest",
  "playwright",
  "pytest",
  "python",
  "python3",
  "uv",
  "go",
  "cargo",
  "make",
  "eslint",
  "biome",
  "prettier",
]);

const SHELL_META = /[;|&$`<>\n\r]/;

/** Why a repo-relative path is malformed, or undefined when it's fine. */
function pathIssue(p: string, where: string): PlanIssue | undefined {
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p))
    return {
      code: "path_absolute",
      message: `"${p}" is absolute; use a repo-relative path.`,
      path: where,
    };
  if (p.includes("\\"))
    return { code: "path_backslash", message: `"${p}" uses backslashes; use "/".`, path: where };
  if (p.startsWith("./"))
    return { code: "path_dot_prefix", message: `"${p}" starts with "./"; drop it.`, path: where };
  if (p.split("/").includes(".."))
    return { code: "path_parent", message: `"${p}" leaves the repository with "..".`, path: where };
  return undefined;
}

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dup: string[] = [];
  for (const id of ids) {
    if (seen.has(id) && !dup.includes(id)) dup.push(id);
    seen.add(id);
  }
  return dup;
}

/** Every dependency cycle, each reported once, starting from its first task in plan order. */
function findCycles(plan: SquadPlan): string[][] {
  const ids = new Set(plan.tasks.map((t) => t.id));
  const deps = new Map(plan.tasks.map((t) => [t.id, t.dependsOn.filter((d) => ids.has(d))]));
  const color = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const seen = new Set<string>();

  const visit = (id: string) => {
    color.set(id, 1);
    stack.push(id);
    for (const d of deps.get(id) ?? []) {
      // A self-dependency has its own issue; don't report it as a cycle too.
      if (d === id) continue;
      const c = color.get(d) ?? 0;
      if (c === 0) visit(d);
      else if (c === 1) {
        const cycle = stack.slice(stack.indexOf(d));
        const key = [...cycle].sort().join("\0");
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push(cycle);
        }
      }
    }
    stack.pop();
    color.set(id, 2);
  };
  for (const t of plan.tasks) if ((color.get(t.id) ?? 0) === 0) visit(t.id);
  return cycles;
}

/**
 * Checks a plan's cross-field rules. Returns every issue found, in a stable order
 * (rule by rule, plan order within a rule); an empty list means the plan is valid.
 */
export function validatePlan(plan: SquadPlan): PlanIssue[] {
  const issues: PlanIssue[] = [];
  // The first role with an id is the one tasks refer to; later duplicates are reported.
  const roles = new Map<string, PlanRole>();
  for (const r of plan.roles) if (!roles.has(r.id)) roles.set(r.id, r);
  const taskIds = new Set(plan.tasks.map((t) => t.id));
  // Malformed paths get their own issue and stay out of the relational rules below,
  // so one bad path doesn't cascade into a pile of confusing overlaps.
  const okPath = (p: string, where: string): boolean => {
    const bad = pathIssue(p, where);
    if (bad) issues.push(bad);
    return !bad;
  };

  for (const id of duplicates(plan.roles.map((r) => r.id)))
    issues.push({ code: "duplicate_role", message: `Role id "${id}" is used more than once.` });
  for (const id of duplicates(plan.tasks.map((t) => t.id)))
    issues.push({ code: "duplicate_task", message: `Task id "${id}" is used more than once.` });
  for (const id of duplicates(plan.checks.map((c) => c.id)))
    issues.push({ code: "duplicate_check", message: `Check id "${id}" is used more than once.` });

  // Paths: validate shape once, keep the good ones for the relational rules.
  const shared: string[] = [];
  plan.shared.paths.forEach((p, i) => {
    if (okPath(p, `shared.paths[${i}]`)) shared.push(p);
  });
  const owns = plan.roles.map((r, ri) =>
    r.owns.filter((p, oi) => okPath(p, `roles[${ri}].owns[${oi}]`)),
  );
  // A role with a malformed prefix can't be judged on what it writes until that's fixed.
  const judgeable = (ri: number) => (owns[ri] ?? []).length === plan.roles[ri]?.owns.length;
  const writes = plan.tasks.map((t, ti) =>
    t.writes.map((p, wi) => (okPath(p, `tasks[${ti}].writes[${wi}]`) ? p : undefined)),
  );
  const contractOk = plan.contracts.map((c, ci) => okPath(c.path, `contracts[${ci}].path`));
  plan.checks.forEach((c, ci) => {
    if (c.cwd !== ".") okPath(c.cwd, `checks[${ci}].cwd`);
  });

  // Ownership: no two writing roles share a path, and nobody owns a shared file.
  plan.roles.forEach((a, ai) => {
    if (a.kind === "planner") return;
    for (let bi = ai + 1; bi < plan.roles.length; bi++) {
      const b = plan.roles[bi]!;
      if (b.kind === "planner" || b.id === a.id) continue;
      for (const pa of owns[ai] ?? [])
        for (const pb of owns[bi] ?? [])
          if (overlaps(pa, pb))
            issues.push({
              code: "owns_overlap",
              message: `Roles "${a.id}" and "${b.id}" overlap: "${pa}" and "${pb}"; each path needs a single owner.`,
              path: `roles[${bi}].owns[${b.owns.indexOf(pb)}]`,
            });
    }
    for (const p of owns[ai] ?? [])
      for (const s of shared)
        if (overlaps(p, s))
          issues.push({
            code: "shared_owned",
            message: `Role "${a.id}" owns "${p}", which covers the shared path "${s}"; shared files belong to Gravita.`,
            path: `roles[${ai}].owns[${a.owns.indexOf(p)}]`,
          });
  });

  // Tasks: a known role, writes inside that role's paths, sane dependencies.
  plan.tasks.forEach((t, ti) => {
    const role = roles.get(t.role);
    if (!role) {
      issues.push({
        code: "unknown_role",
        message: `Task "${t.id}" is assigned to "${t.role}", which is not a role in this plan.`,
        path: `tasks[${ti}].role`,
      });
    } else if (role.kind === "planner") {
      issues.push({
        code: "planner_has_tasks",
        message: `Task "${t.id}" is assigned to the planner "${t.role}"; the planner plans, it doesn't build.`,
        path: `tasks[${ti}].role`,
      });
    } else if (judgeable(plan.roles.indexOf(role))) {
      const roleOwns = owns[plan.roles.indexOf(role)] ?? [];
      (writes[ti] ?? []).forEach((w, wi) => {
        if (w === undefined) return;
        if (!roleOwns.some((o) => isWithin(w, o)))
          issues.push({
            code: "write_outside_owns",
            message: `Task "${t.id}" writes "${w}", outside what role "${role.id}" owns (${role.owns.join(", ")}).`,
            path: `tasks[${ti}].writes[${wi}]`,
          });
      });
    }
    t.dependsOn.forEach((d, di) => {
      const where = `tasks[${ti}].dependsOn[${di}]`;
      if (d === t.id)
        issues.push({
          code: "self_dependency",
          message: `Task "${t.id}" depends on itself.`,
          path: where,
        });
      else if (!taskIds.has(d))
        issues.push({
          code: "unknown_dependency",
          message: `Task "${t.id}" depends on "${d}", which is not a task in this plan.`,
          path: where,
        });
      else if (t.foundation && !plan.tasks.find((x) => x.id === d)?.foundation)
        issues.push({
          code: "foundation_depends_on_build",
          message: `Foundation task "${t.id}" depends on "${d}", a build task; foundation runs first.`,
          path: where,
        });
    });
  });

  for (const cycle of findCycles(plan))
    issues.push({
      code: "dependency_cycle",
      message: `Tasks depend on each other in a loop: ${[...cycle, cycle[0]].join(" → ")}.`,
      path: `tasks[${plan.tasks.findIndex((t) => t.id === cycle[0])}].dependsOn`,
    });

  // Contracts: a known owner, and a file that owner may write.
  plan.contracts.forEach((c, ci) => {
    const owner = roles.get(c.owner);
    if (!owner) {
      issues.push({
        code: "unknown_role",
        message: `Contract "${c.path}" is owned by "${c.owner}", which is not a role in this plan.`,
        path: `contracts[${ci}].owner`,
      });
      return;
    }
    if (!contractOk[ci] || !judgeable(plan.roles.indexOf(owner))) return;
    const ownerOwns = owns[plan.roles.indexOf(owner)] ?? [];
    if (owner.kind === "planner" || !ownerOwns.some((o) => isWithin(c.path, o)))
      issues.push({
        code: "contract_outside_owner",
        message: `Contract "${c.path}" sits outside what its owner "${owner.id}" owns (${owner.owns.join(", ")}).`,
        path: `contracts[${ci}].path`,
      });
  });

  // Checks: a known program and plain arguments.
  plan.checks.forEach((c, ci) => {
    const program = c.argv[0] ?? "";
    if (!CHECK_PROGRAMS.has(program))
      issues.push({
        code: "check_program_not_allowed",
        message: `Check "${c.id}" runs "${program}", which is not an allowed program (${[...CHECK_PROGRAMS].join(", ")}).`,
        path: `checks[${ci}].argv[0]`,
      });
    c.argv.forEach((arg, ai) => {
      if (SHELL_META.test(arg))
        issues.push({
          code: "check_shell_metachar",
          message: `Check "${c.id}" has the argument "${arg.replace(/[\n\r]/g, "⏎")}" with shell characters (; | & $ \` < > or a newline); list each argument plainly.`,
          path: `checks[${ci}].argv[${ai}]`,
        });
    });
  });

  // Work: somebody besides the planner has something to do.
  const builds = plan.tasks.some((t) => {
    const r = roles.get(t.role);
    return r !== undefined && r.kind !== "planner";
  });
  if (!builds)
    issues.push({ code: "no_work", message: "No role other than the planner has a task." });

  return issues;
}
