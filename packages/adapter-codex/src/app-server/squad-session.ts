import type { Model, SandboxPolicy } from "./protocol";
import type { CodexSessionPolicy } from "./session-policy";

// What a squad session on Codex asks of the app-server, in Codex's own terms. Pure, so the
// engine's runtime and the tests share one reading of it.

/**
 * How much a squad session may do without asking, by the squad's autonomy for a role, or
 * by the planning session's access (the planner reads; the briefing reads and asks).
 */
export type CodexSquadAccess = "ask" | "guarded" | "auto" | "read-only" | "read-and-ask";

/**
 * The sandbox and approval policy of a squad session. A role writes only in its worktree
 * (the sandbox's one writable root); what it may do beyond that, and what it asks about:
 *
 *   ask       "untrusted": every edit and every command that isn't a known read-only one
 *             comes to Gravita for approval (the ownership guard, then the user).
 *   guarded   "on-request": edits and commands inside the worktree run on their own, without
 *             network; anything that needs more (the network, writes outside) comes to Gravita.
 *   auto      "never": nothing is asked; the sandbox (the worktree, with network) and
 *             Gravita's commit gate are the limits.
 *   read-only     the planner: a read-only sandbox, never asks (anything more is refused).
 *   read-and-ask  the briefing: a read-only sandbox; what it asks for is refused, its
 *             questions go to the user.
 */
export function codexSquadPolicy(access: CodexSquadAccess, worktree: string): CodexSessionPolicy {
  const readOnly: SandboxPolicy = { type: "readOnly", networkAccess: false };
  const workspace = (networkAccess: boolean): SandboxPolicy => ({
    type: "workspaceWrite",
    writableRoots: [worktree],
    networkAccess,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  });
  switch (access) {
    case "read-only":
      return { approvalPolicy: "never", sandbox: "read-only", sandboxPolicy: readOnly };
    case "read-and-ask":
      return { approvalPolicy: "on-request", sandbox: "read-only", sandboxPolicy: readOnly };
    case "ask":
      return {
        approvalPolicy: "untrusted",
        sandbox: "workspace-write",
        sandboxPolicy: workspace(false),
      };
    case "guarded":
      return {
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
        sandboxPolicy: workspace(false),
      };
    case "auto":
      return {
        approvalPolicy: "never",
        sandbox: "workspace-write",
        sandboxPolicy: workspace(true),
      };
  }
}

/** Codex's reasoning efforts, weakest first (the ones a catalog may list). */
const EFFORT_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh", "ultra"];

/**
 * A squad's Codex model ("<model>@<effort>", "default" for the account's default) resolved
 * against Codex's own catalog (`model/list`): the default model is the one marked
 * `isDefault` (left out, so Codex picks it itself, when the catalog is unknown), and an
 * effort the model doesn't support becomes the nearest one it does (the stronger one on a
 * tie), so a tier never asks Codex for something it refuses.
 */
export function resolveCodexModel(
  wanted: { model?: string; effort?: string },
  catalog: readonly Pick<Model, "model" | "isDefault" | "supportedReasoningEfforts">[],
): { model?: string; effort?: string } {
  const entry = wanted.model
    ? catalog.find((m) => m.model === wanted.model)
    : catalog.find((m) => m.isDefault);
  const model = wanted.model ?? entry?.model;
  const supported = (entry?.supportedReasoningEfforts ?? []).map((e) => e.reasoningEffort);
  let effort = wanted.effort;
  if (effort && supported.length && !supported.includes(effort)) {
    const at = EFFORT_ORDER.indexOf(effort);
    const ranked = supported
      .filter((e) => EFFORT_ORDER.includes(e))
      .sort(
        (a, b) =>
          Math.abs(EFFORT_ORDER.indexOf(a) - at) - Math.abs(EFFORT_ORDER.indexOf(b) - at) ||
          EFFORT_ORDER.indexOf(b) - EFFORT_ORDER.indexOf(a),
      );
    effort = ranked[0] ?? effort;
  }
  return { ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
}

type Json = Record<string, unknown>;

/** Keywords OpenAI's strict structured outputs refuse; the checks stay with Gravita's own. */
const UNSUPPORTED = new Set(["$schema", "minLength", "maxLength", "format", "default"]);

/**
 * A JSON Schema in the strict form Codex's structured output (`outputSchema`) needs: every
 * object closes (`additionalProperties: false`) and lists all its properties as required,
 * an optional property becoming one that may be null, and keywords strict mode refuses
 * dropped. A dropped length limit moves into the field's description, so the model still
 * knows it (without it, a real planner wrote an acceptance line over 200 characters). Gravita
 * still checks the answer with its own schema (`withoutNulls` first).
 */
export function strictOutputSchema(schema: Json): Json {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    const out: Json = {};
    for (const [k, v] of Object.entries(node as Json)) {
      if (UNSUPPORTED.has(k)) continue;
      out[k] = k === "properties" || k === "definitions" || k === "$defs" ? mapValues(v) : walk(v);
    }
    const limit = lengthNote(node as Json);
    if (limit)
      out.description = typeof out.description === "string" ? `${out.description} ${limit}` : limit;
    if (out.type === "object" && out.properties && typeof out.properties === "object") {
      const props = out.properties as Json;
      const required = new Set(Array.isArray(out.required) ? (out.required as string[]) : []);
      for (const [name, prop] of Object.entries(props))
        if (!required.has(name)) props[name] = nullable(prop);
      out.required = Object.keys(props);
      out.additionalProperties = false;
    }
    return out;
  };
  const mapValues = (v: unknown): unknown => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return walk(v);
    return Object.fromEntries(Object.entries(v as Json).map(([k, x]) => [k, walk(x)]));
  };
  return walk(schema) as Json;
}

/** A string's length limits in words, e.g. "At most 200 characters." */
function lengthNote(node: Json): string | undefined {
  const min = typeof node.minLength === "number" && node.minLength > 1 ? node.minLength : undefined;
  const max = typeof node.maxLength === "number" ? node.maxLength : undefined;
  if (min !== undefined && max !== undefined) return `Between ${min} and ${max} characters.`;
  if (max !== undefined) return `At most ${max} characters.`;
  if (min !== undefined) return `At least ${min} characters.`;
  return undefined;
}

/** A property that may also be null. */
function nullable(prop: unknown): unknown {
  if (!prop || typeof prop !== "object") return prop;
  const p = prop as Json;
  if (Array.isArray(p.anyOf)) return { ...p, anyOf: [...p.anyOf, { type: "null" }] };
  return { anyOf: [p, { type: "null" }] };
}

/** The answer with its nulls taken out: a strict schema's "absent". */
export function withoutNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutNulls);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Json)
      .filter(([, v]) => v !== null)
      .map(([k, v]) => [k, withoutNulls(v)]),
  );
}
