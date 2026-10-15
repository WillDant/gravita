import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { RpcContract } from "@gravita/protocol";
import { MemoryCredentialSource } from "../../src/infrastructure/credentials/memory-credential-source";
import type { CursorAcpRuntime } from "../../src/infrastructure/cursor/cursor-acp-runtime";
import { createCore } from "../../src/main/container";
import { call, eventsOf, UuidIds } from "../codex-rpc-helpers";
import {
  CURSOR_ENV,
  CursorLauncher,
  cursorScript,
  cursorSessionOf,
  FakeKeyValidator,
  TEST_KEY,
} from "../cursor-helpers";
import { FakeClaudeEnvironment, FakeClock, FakeWorkspace, SilentLogger } from "../fakes";
import { withTempDir } from "../helpers";

// docs/COMPLIANCE.md, "Cursor API key (exception)", enforced: the key the user pasted in
// Gravita lives in the engine's memory only. It is never stored (the database), never
// published (events, status, RPC results), never on a command line, and only ever reaches a
// `cursor-agent` process Gravita starts. Gravita never logs anyone in to Cursor and never
// reads the user's own Cursor login.

const ROOT = join(import.meta.dir, "../../../..");

async function sources(dir: string): Promise<{ path: string; text: string }[]> {
  const out: { path: string; text: string }[] = [];
  for (const name of await readdir(dir, { recursive: true })) {
    if (!name.endsWith(".ts")) continue;
    const path = join(dir, name);
    out.push({ path, text: await readFile(path, "utf8") });
  }
  return out;
}

/** The code, without its comments (which may name what the code must never do). */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("Cursor compliance", () => {
  test("the key is in no stored event, no status and no log, even when the agent prints it", async () => {
    await withTempDir(async (dir) => {
      const dbPath = join(dir, "gravita.db");
      const launcher = new CursorLauncher(cursorScript("sentinel-key"));
      const logger = new SilentLogger();
      const core = createCore({
        dbPath,
        demo: false,
        clock: new FakeClock(),
        logger,
        ids: new UuidIds(),
        projectDirectory: {
          resolve: async (cwd) => ({ id: `p:${cwd}`, root: cwd, name: "demo" }),
        },
        chat: {
          environment: new FakeClaudeEnvironment(),
          cursorEnvironment: new FakeClaudeEnvironment(CURSOR_ENV),
          cursorLaunch: launcher.launch,
          credentials: new MemoryCredentialSource(TEST_KEY),
          cursorValidator: new FakeKeyValidator(),
          workspace: new FakeWorkspace(),
        },
      });
      const sid = cursorSessionOf(5);
      await call(core, "session.start", {
        cwd: "/work/demo",
        prompt: "Print it",
        provider: "cursor",
      });
      await (core.runtimes.get(sid) as CursorAcpRuntime).nextTurn();
      expect(await call<unknown>(core, "cursorKey.validate")).toEqual({ source: "app", state: "valid" });
      const status = JSON.stringify(await call(core, "engine.status"));
      const snapshot = JSON.stringify(await call(core, "state.snapshot"));
      expect(eventsOf(core).length).toBeGreaterThan(3);
      await core.disposeRuntimes();
      core.close();
      const db = await readFile(dbPath);
      expect(db.includes(Buffer.from(TEST_KEY))).toBe(false);
      for (const text of [status, snapshot, logger.lines.join("\n")])
        expect(text).not.toContain(TEST_KEY);
      // The key went to the one place it must: the agent's environment.
      expect(launcher.launches[0]?.env.CURSOR_API_KEY).toBe(TEST_KEY);
    });
  });

  test("no RPC method takes or answers a key", () => {
    const shape = JSON.stringify(
      Object.fromEntries(
        Object.entries(RpcContract).map(([m, c]) => [
          m,
          Object.keys((c.params as { shape?: object }).shape ?? {}),
        ]),
      ),
    );
    expect(shape).not.toMatch(/apiKey|cursorKey"|secret/i);
  });

  test("Gravita never logs anyone in to Cursor, nor reads the user's own Cursor login", async () => {
    const files = [
      ...(await sources(join(ROOT, "apps/engine/src"))),
      ...(await sources(join(ROOT, "packages/adapter-cursor/src"))),
    ];
    for (const { path, text } of files) {
      const c = code(text);
      // ACP's `authenticate` starts a browser login: never sent.
      expect(c, path).not.toMatch(/["']authenticate["']/);
      // `cursor-agent login|logout|status` would touch the user's own login.
      expect(c, path).not.toMatch(/["'](login|logout)["']\s*[\],]/);
      // ~/.cursor holds the user's own login: only transcripts and chat metadata are read
      // (the discovery test audits the paths), never these.
      expect(c, path).not.toMatch(/["'`][^"'`]*\.cursor\/(auth|cli-config|mcp-auth)/);
      expect(c, path).not.toMatch(/["'`](auth|cli-config|mcp-auth)\.json["'`]/);
      expect(c, path).not.toMatch(/acp-sessions|store\.db/);
      // The Cursor home is named in one place: the engine's start-up options.
      if (!path.endsWith("src/main/container.ts")) {
        expect(c, path).not.toMatch(/join\([^)]*["']\.cursor["']/);
      }
      // The engine never touches the Keychain: the desktop shell owns the key's storage.
      expect(c, path).not.toMatch(/find-generic-password|add-generic-password|security-framework/);
    }
  });

  test("only the cursor-agent processes get the key", async () => {
    const files = await sources(join(ROOT, "apps/engine/src"));
    const users = files
      .filter(({ text }) => /\bCURSOR_API_KEY\b/.test(code(text)))
      .map((f) => f.path);
    expect(users.map((p) => p.slice(p.indexOf("src/"))).sort()).toEqual([
      "src/infrastructure/cursor/cursor-environment.ts",
      "src/main/container.ts",
    ]);
  });
});
