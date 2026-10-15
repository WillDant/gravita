import { describe, expect, test } from "bun:test";
import {
  applyBootstrapLine,
  MemoryCredentialSource,
} from "../../src/infrastructure/credentials/memory-credential-source";
import {
  CursorDetector,
  knownCursorPaths,
  MIN_CURSOR_VERSION,
} from "../../src/infrastructure/cursor/cursor-detector";
import { cursorChatEnv } from "../../src/infrastructure/cursor/cursor-environment";
import {
  type CommandResult,
  CursorCliKeyValidator,
  classifyModelsOutput,
  type RunWithEnv,
} from "../../src/infrastructure/cursor/cursor-key-validator";
import { filterCursorEnv, isCursorEnvKey } from "../../src/infrastructure/system/login-shell-env";
import { readStdinBootstrap } from "../../src/main/stdin-bootstrap";
import { CURSOR_ENV, TEST_KEY } from "../cursor-helpers";
import { FakeClaudeEnvironment } from "../fakes";

describe("Cursor's environment", () => {
  test("only the base allowlist and the locale pass from the shell", () => {
    expect(isCursorEnvKey("PATH")).toBe(true);
    expect(isCursorEnvKey("LC_ALL")).toBe(true);
    expect(isCursorEnvKey("HTTPS_PROXY")).toBe(true);
    for (const k of [
      "CURSOR_API_KEY",
      "CURSOR_AUTH_TOKEN",
      "CURSOR_API_ENDPOINT",
      "CURSOR_TRACE_ID",
      "AGENT_CLI_CREDENTIAL_STORE",
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "AWS_SECRET_ACCESS_KEY",
    ])
      expect(isCursorEnvKey(k)).toBe(false);
  });

  test("a chat's environment is built from scratch with the key pasted in Gravita", () => {
    const env = cursorChatEnv({ ...CURSOR_ENV.env, LC_ALL: "pt_BR.UTF-8", EMPTY: "" }, TEST_KEY);
    expect(env).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/u",
      HTTPS_PROXY: "http://proxy.local:3128",
      LC_ALL: "pt_BR.UTF-8",
      CURSOR_API_KEY: TEST_KEY,
      AGENT_CLI_CREDENTIAL_STORE: "memory",
      NO_OPEN_BROWSER: "1",
      GRAVITA_MANAGED: "1",
    });
    expect(filterCursorEnv({ CURSOR_API_KEY: "x", PATH: "/bin" })).toEqual({ PATH: "/bin" });
  });
});

describe("Cursor's detector", () => {
  test("the known install path and the tested version", () => {
    expect(knownCursorPaths("/home/u")[0]).toBe("/home/u/.local/bin/cursor-agent");
    expect(MIN_CURSOR_VERSION).toBe("2026.10.14");
  });

  test("the key's state is asked only of a found, current CLI", async () => {
    let asked = 0;
    const detector = new CursorDetector(
      async () => ({ found: true, path: "/x", version: "2026.10.14" }),
      async () => {
        asked++;
        return { credential: { source: "app", state: "valid" } };
      },
    );
    expect(await detector.account({ found: false })).toBeUndefined();
    expect(await detector.account({ found: true, path: "/x", outdated: true })).toBeUndefined();
    expect(await detector.account({ found: true, path: "/x" })).toEqual({
      credential: { source: "app", state: "valid" },
    });
    expect(asked).toBe(1);
  });
});

describe("checking a key with cursor-agent models", () => {
  const out = (code: number | null, output = ""): CommandResult => ({ code, output });

  test("exit 0 is valid; Cursor's refusals are invalid; anything else is unchecked", () => {
    expect(classifyModelsOutput(out(0, "Auto\nComposer 2.5"))).toBe("valid");
    expect(classifyModelsOutput(out(1, "Error: The provided API key is invalid"))).toBe("invalid");
    expect(
      classifyModelsOutput(out(1, "Your credentials or API key are invalid or expired.")),
    ).toBe("invalid");
    expect(classifyModelsOutput(out(1, "Failed to reach the Cursor API"))).toBe("unchecked");
    expect(classifyModelsOutput(out(null, ""))).toBe("unchecked");
  });

  test("the key goes in the environment, never on the command line", async () => {
    const calls: { cmd: string[]; env: Record<string, string> }[] = [];
    const run: RunWithEnv = async (cmd, env) => {
      calls.push({ cmd, env });
      return out(0);
    };
    const validator = new CursorCliKeyValidator(new FakeClaudeEnvironment(CURSOR_ENV), run);
    expect(await validator.validate(TEST_KEY)).toBe("valid");
    expect(calls[0]?.cmd).toEqual([CURSOR_ENV.cliPath, "models"]);
    expect(calls[0]?.env).toMatchObject({
      CURSOR_API_KEY: TEST_KEY,
      AGENT_CLI_CREDENTIAL_STORE: "memory",
      NO_OPEN_BROWSER: "1",
    });
    expect(calls[0]?.env.CURSOR_AUTH_TOKEN).toBeUndefined();
  });

  test("without the CLI the key can't be checked", async () => {
    const validator = new CursorCliKeyValidator(new FakeClaudeEnvironment(new Error("not found")));
    expect(await validator.validate(TEST_KEY)).toBe("unchecked");
  });
});

describe("the key in the engine's memory", () => {
  test("set, replaced and removed; listeners hear only changes; it never prints", () => {
    const source = new MemoryCredentialSource();
    let changes = 0;
    source.onChange(() => changes++);
    source.setCursorKey(`  ${TEST_KEY}\n`);
    expect(source.cursorKey()).toBe(TEST_KEY);
    source.setCursorKey(TEST_KEY);
    expect(changes).toBe(1);
    expect(String(source)).not.toContain(TEST_KEY);
    expect(JSON.stringify({ source })).not.toContain(TEST_KEY);
    source.setCursorKey("");
    expect(source.cursorKey()).toBeUndefined();
    expect(changes).toBe(2);
  });

  test("bootstrap lines: the key message, and nothing else", () => {
    const source = new MemoryCredentialSource();
    expect(applyBootstrapLine(JSON.stringify({ type: "cursorKey", value: TEST_KEY }), source)).toBe(
      true,
    );
    expect(source.cursorKey()).toBe(TEST_KEY);
    expect(applyBootstrapLine("ping", source)).toBe(false);
    expect(applyBootstrapLine('{"type":"other","value":"x"}', source)).toBe(false);
    expect(applyBootstrapLine('{"type":"cursorKey","value":42}', source)).toBe(false);
    expect(source.cursorKey()).toBe(TEST_KEY);
    expect(applyBootstrapLine('{"type":"cursorKey","value":null}', source)).toBe(true);
    expect(source.cursorKey()).toBeUndefined();
  });

  test("stdin: the token first, the key in the same chunk or later, EOF at the end", async () => {
    const enc = new TextEncoder();
    let push!: (s: string) => void;
    let close!: () => void;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        push = (s) => c.enqueue(enc.encode(s));
        close = () => c.close();
      },
    });
    const source = new MemoryCredentialSource();
    let eof = false;
    push(`tok-123\n${JSON.stringify({ type: "cursorKey", value: TEST_KEY })}\n`);
    expect(await readStdinBootstrap(stream, source, () => (eof = true))).toBe("tok-123");
    expect(source.cursorKey()).toBe(TEST_KEY);
    push('{"type":"cursorKey",');
    push('"value":null}\n');
    await Bun.sleep(5);
    expect(source.cursorKey()).toBeUndefined();
    close();
    await Bun.sleep(5);
    expect(eof).toBe(true);
  });
});
