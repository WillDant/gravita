import type { PlanRole, SquadPlan } from "@gravita/protocol";

// Repo-relative path helpers shared by the validator and the commit gate. Paths compare
// by segment, so "apps/api" contains "apps/api/src" but not "apps/api-gateway".

/**
 * Canonical form of a repo-relative path or prefix: no leading "./", no trailing "/",
 * no empty segments. "." (the repo root) becomes "".
 */
export function normalizePath(path: string): string {
  let p = path;
  while (p.startsWith("./")) p = p.slice(2);
  const segs = p.split("/").filter((s) => s !== "" && s !== ".");
  // Planners often write a folder as a glob ("apps/api/**"); a trailing wildcard means
  // the folder itself, so it's read as that prefix. Wildcards elsewhere are rejected by
  // validatePlan.
  while (segs.length > 0 && (segs.at(-1) === "**" || segs.at(-1) === "*")) segs.pop();
  return segs.join("/");
}

/** True when `path` is `prefix` itself or sits under it (segment-aware). */
export function isWithin(path: string, prefix: string): boolean {
  const p = normalizePath(path);
  const pre = normalizePath(prefix);
  if (pre === "") return true;
  return p === pre || p.startsWith(`${pre}/`);
}

/** Two prefixes overlap when either contains the other. */
export function overlaps(a: string, b: string): boolean {
  return isWithin(a, b) || isWithin(b, a);
}

// A planner never writes: its `owns` grant nothing, so it never owns a path.
const writers = (plan: SquadPlan): PlanRole[] => plan.roles.filter((r) => r.kind !== "planner");

/** True when the path is (or is inside) one of the plan's shared paths. */
export function isShared(plan: SquadPlan, path: string): boolean {
  return plan.shared.paths.some((s) => isWithin(path, s));
}

/** The role that owns a repo path, or undefined (unowned, shared, or planner-only). */
export function ownerOf(plan: SquadPlan, path: string): string | undefined {
  if (isShared(plan, path)) return undefined;
  return writers(plan).find((r) => r.owns.some((o) => isWithin(path, o)))?.id;
}

/**
 * The changed paths a role may not touch: outside its `owns`, or shared (Gravita
 * regenerates those). Order is kept, duplicates dropped. Unknown and planner roles may
 * change nothing.
 */
export function outsideOwnership(
  plan: SquadPlan,
  roleId: string,
  changedPaths: readonly string[],
): string[] {
  const role = writers(plan).find((r) => r.id === roleId);
  const out: string[] = [];
  for (const path of changedPaths) {
    const allowed =
      role !== undefined && !isShared(plan, path) && role.owns.some((o) => isWithin(path, o));
    if (!allowed && !out.includes(path)) out.push(path);
  }
  return out;
}
