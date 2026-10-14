import { describe, expect, test } from "bun:test";
import { inputKeyOf } from "../src/input-key";
import { RpcContract, RpcErrors } from "../src/rpc";
import { inputPreview, preview, stableJson, toolTarget } from "../src/tools";

describe("providers in the RPC contract", () => {
  test("session.start takes an optional provider and either provider's modes", () => {
    const schema = RpcContract["session.start"].params;
    const base = { cwd: "/w", prompt: "hi" };
    expect(schema.safeParse(base).success).toBe(true);
    expect(
      schema.safeParse({ ...base, provider: "codex", permissionMode: "workspace" }).success,
    ).toBe(true);
    expect(schema.safeParse({ ...base, permissionMode: "acceptEdits" }).success).toBe(true);
    expect(schema.safeParse({ ...base, provider: "gravita" }).success).toBe(false);
    expect(schema.safeParse({ ...base, permissionMode: "yolo" }).success).toBe(false);
  });

  test("models.list names its provider; claude.models stays as the alias", () => {
    expect(RpcContract["models.list"].params.safeParse({ provider: "codex" }).success).toBe(true);
    expect(RpcContract["models.list"].params.safeParse({}).success).toBe(false);
    expect(RpcContract["claude.models"].params.safeParse(undefined).success).toBe(true);
  });

  test("engine.status carries providers and the deprecated claude alias", () => {
    const claude = { found: true, path: "/bin/claude", account: { planType: "max" } };
    const status = { providers: { claude }, claude, indexing: { done: 0, total: 0 }, demo: false };
    expect(RpcContract["engine.status"].result.parse(status)).toEqual(status);
  });

  test("Cursor: its modes start a session, and its status carries the key's state", () => {
    const start = RpcContract["session.start"].params;
    for (const permissionMode of ["agent", "plan", "ask"])
      expect(
        start.safeParse({ cwd: "/w", prompt: "hi", provider: "cursor", permissionMode }).success,
      ).toBe(true);
    const cursor = { found: true, credential: { source: "app", state: "valid" } };
    const claude = { found: false };
    const status = {
      providers: { claude, cursor },
      claude,
      indexing: { done: 0, total: 0 },
      demo: false,
    };
    expect(RpcContract["engine.status"].result.parse(status).providers.cursor).toEqual(cursor);
    const credential = (c: unknown) =>
      RpcContract["engine.status"].result.safeParse({
        ...status,
        providers: { claude, cursor: { found: true, credential: c } },
      }).success;
    expect(credential({ source: "none", state: "missing" })).toBe(true);
    expect(credential({ source: "app", state: "unchecked" })).toBe(true);
    expect(credential({ source: "env", state: "valid" })).toBe(false);
    expect(credential({ source: "none", state: "valid" })).toBe(false);
    expect(credential({ source: "app", state: "missing" })).toBe(false);
  });

  test("cursorKey.validate takes nothing and answers the key's state, never the key", () => {
    const { params, result } = RpcContract["cursorKey.validate"];
    expect(params.safeParse(undefined).success).toBe(true);
    expect(result.parse({ source: "app", state: "invalid" })).toEqual({
      source: "app",
      state: "invalid",
    });
  });

  test("no method takes or returns a key's value", () => {
    // An event's `key` is its idempotency key; `auth` takes the engine's session token.
    const names = /(api_?key|cursor_?key|secret|password|credential_?value|token)$/i;
    const walk = (schema: unknown, path: string, out: string[]) => {
      const def = (schema as { def?: Record<string, unknown> } | undefined)?.def;
      if (!def) return;
      if (def.type === "object") {
        const shape = (schema as { shape: Record<string, unknown> }).shape;
        for (const [k, v] of Object.entries(shape)) {
          if (names.test(k)) out.push(`${path}.${k}`);
          walk(v, `${path}.${k}`, out);
        }
      }
      for (const inner of ["innerType", "element", "in", "out"]) walk(def[inner], path, out);
      if (Array.isArray(def.options)) for (const o of def.options) walk(o, path, out);
    };
    const found: string[] = [];
    for (const [method, c] of Object.entries(RpcContract)) {
      if (method === "auth") continue;
      walk(c.params, `${method}.params`, found);
      walk(c.result, `${method}.result`, found);
    }
    expect(found).toEqual([]);
  });

  test("the provider errors keep their codes; the old key is the same error", () => {
    expect(RpcErrors.providerUnavailable.code).toBe(4005);
    expect(RpcErrors.claudeUnavailable).toBe(RpcErrors.providerUnavailable);
    expect(RpcErrors.notLoggedIn.code).toBe(4008);
    expect(RpcErrors.providerUnavailable.message).not.toContain("Claude");
  });
});

describe("shared tool helpers", () => {
  test("previews are one line, cut with an ellipsis", () => {
    expect(preview("  a\n\n b  ")).toBe("a b");
    expect(preview("x".repeat(10), 5)).toBe("xxxx…");
  });

  test("the target and the preview of an input", () => {
    expect(toolTarget({ file_path: "a.ts", pattern: "TODO", subagent_type: "Explore" })).toEqual({
      path: "a.ts",
      query: "TODO",
      agentType: "Explore",
    });
    expect(inputPreview({ description: "Run tests", command: "pnpm test" })).toBe("Run tests");
    expect(inputPreview({ other: 1 })).toBe('{"other":1}');
  });

  test("stable JSON and input keys ignore key order", () => {
    expect(stableJson({ b: 1, a: [{ d: 1, c: undefined }] })).toBe('{"a":[{"d":1}],"b":1}');
    expect(inputKeyOf("Bash", { a: 1, b: 2 })).toBe(inputKeyOf("Bash", { b: 2, a: 1 }));
    expect(inputKeyOf("Bash", { a: 1 })).toMatch(/^[0-9a-f]{16}$/);
  });
});
