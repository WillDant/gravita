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
