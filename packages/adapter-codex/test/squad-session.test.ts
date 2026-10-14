import { describe, expect, test } from "bun:test";
import { SquadPlan, squadPlanJsonSchema } from "@gravita/protocol";
import { codexSquadPolicy, resolveCodexModel, strictOutputSchema, withoutNulls } from "../src";

// What a squad session on Codex asks of the app-server: its sandbox and approvals by
// autonomy, its tier resolved against the catalog, and the plan's schema in the strict form
// Codex's structured output takes.

const WT = "/data/worktrees/p/q/backend";

describe("a squad session's sandbox and approvals", () => {
  test.each([
    [
      "ask",
      "untrusted",
      "workspace-write",
      { type: "workspaceWrite", writableRoots: [WT], networkAccess: false },
    ],
    [
      "guarded",
      "on-request",
      "workspace-write",
      { type: "workspaceWrite", writableRoots: [WT], networkAccess: false },
    ],
    [
      "auto",
      "never",
      "workspace-write",
      { type: "workspaceWrite", writableRoots: [WT], networkAccess: true },
    ],
    ["read-only", "never", "read-only", { type: "readOnly", networkAccess: false }],
    ["read-and-ask", "on-request", "read-only", { type: "readOnly", networkAccess: false }],
  ] as const)("%s: approvals %s, sandbox %s", (access, approvalPolicy, sandbox, sandboxPolicy) => {
    const p = codexSquadPolicy(access, WT);
    expect(p.approvalPolicy).toBe(approvalPolicy);
    expect(p.sandbox).toBe(sandbox);
    expect(p.sandboxPolicy).toMatchObject(sandboxPolicy);
  });

  test("a role's only writable root is its worktree (plus Codex's temp dirs)", () => {
    const p = codexSquadPolicy("guarded", WT).sandboxPolicy;
    expect(p).toEqual({
      type: "workspaceWrite",
      writableRoots: [WT],
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    });
  });
});

describe("a squad tier against Codex's catalog", () => {
  const efforts = (...e: string[]) =>
    e.map((reasoningEffort) => ({ reasoningEffort, description: "" }));
  const catalog = [
    {
      model: "gpt-6.1-sol",
      isDefault: true,
      supportedReasoningEfforts: efforts("low", "medium", "high", "xhigh"),
    },
    {
      model: "gpt-6-luna",
      isDefault: false,
      supportedReasoningEfforts: efforts("minimal", "medium"),
    },
  ];

  test("the default model is the catalog's default, at the tier's effort", () => {
    expect(resolveCodexModel({ effort: "high" }, catalog)).toEqual({
      model: "gpt-6.1-sol",
      effort: "high",
    });
  });

  test("an effort the model lacks becomes the nearest one it has (the stronger on a tie)", () => {
    expect(resolveCodexModel({ model: "gpt-6-luna", effort: "high" }, catalog)).toEqual({
      model: "gpt-6-luna",
      effort: "medium",
    });
    expect(resolveCodexModel({ model: "gpt-6-luna", effort: "low" }, catalog)).toEqual({
      model: "gpt-6-luna",
      effort: "medium",
    });
    expect(resolveCodexModel({ model: "gpt-6-luna", effort: "none" }, catalog)).toEqual({
      model: "gpt-6-luna",
      effort: "minimal",
    });
  });

  test("an unknown catalog leaves the choice to Codex", () => {
    expect(resolveCodexModel({ effort: "medium" }, [])).toEqual({ effort: "medium" });
    expect(resolveCodexModel({}, [])).toEqual({});
  });
});

describe("the plan's schema for Codex's structured output", () => {
  const schema = strictOutputSchema(squadPlanJsonSchema());

  /** Every object schema in a tree. */
  const objects = (node: unknown, out: Record<string, unknown>[] = []) => {
    if (Array.isArray(node)) for (const n of node) objects(n, out);
    else if (node && typeof node === "object") {
      const o = node as Record<string, unknown>;
      if (o.type === "object") out.push(o);
      for (const v of Object.values(o)) objects(v, out);
    }
    return out;
  };

  test("every object is closed and lists all of its properties as required", () => {
    const all = objects(schema);
    expect(all.length).toBeGreaterThan(4);
    for (const o of all) {
      expect(o.additionalProperties).toBe(false);
      expect(o.required).toEqual(Object.keys(o.properties as object));
    }
  });

  test("optional fields may be null; keywords strict mode refuses are gone", () => {
    const text = JSON.stringify(schema);
    expect(text).not.toContain("minLength");
    expect(text).not.toContain("maxLength");
    expect(text).not.toContain("$schema");
    // The limits stay known to the model, in words.
    expect(text).toContain("At most 200 characters.");
    const role = objects(schema).find(
      (o) => (o.properties as object) && "owns" in (o.properties as object),
    );
    expect((role?.properties as Record<string, unknown> | undefined)?.provider).toEqual({
      anyOf: [{ type: "string", enum: ["claude", "codex"] }, { type: "null" }],
    });
  });

  test("an answer with nulls for absent fields is a plan once its nulls are taken out", () => {
    const answer = {
      goal: "g",
      summary: "s",
      stack: [],
      roles: [
        {
          id: "api",
          name: "API",
          kind: "backend",
          owns: ["api/"],
          charter: "",
          model: null,
          budgetUsd: null,
          provider: "codex",
        },
      ],
      shared: { paths: [], strategy: "regenerate" },
      contracts: [],
      tasks: [
        {
          id: "t1",
          role: "api",
          title: "T",
          plainSummary: "P",
          dependsOn: [],
          writes: ["api/"],
          acceptance: ["a"],
          size: "s",
          foundation: null,
        },
      ],
      checks: [],
      assumptions: [],
      questions: [],
    };
    expect(SquadPlan.safeParse(answer).success).toBe(false);
    const plan = SquadPlan.parse(withoutNulls(answer));
    expect(plan.roles[0]).toEqual({
      id: "api",
      name: "API",
      kind: "backend",
      owns: ["api/"],
      charter: "",
      provider: "codex",
    });
    expect(plan.tasks[0]?.foundation).toBeUndefined();
  });
});
