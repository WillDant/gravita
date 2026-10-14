import { describe, expect, test } from "bun:test";
import { mkdir, readdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startEngine } from "../../src/main/container";
import { withTempDir } from "../helpers";

// plugins/deep-observe/hooks/forward.sh, run the way Claude Code runs it: `sh forward.sh`
// with the hook's JSON on stdin. Whatever happens, it prints nothing and exits 0.

const PLUGIN = join(import.meta.dir, "../../../../plugins/deep-observe");
const SCRIPT = join(PLUGIN, "hooks/forward.sh");
const TOKEN = "c0ffee".repeat(10).concat("abcd");
const PAYLOAD = JSON.stringify({
  session_id: "55555555-5555-4555-8555-555555555555",
  transcript_path: "/x.jsonl",
  cwd: "/work/demo",
  hook_event_name: "PreToolUse",
  tool_name: "Bash",
  tool_input: { command: 'echo "hi"\nls', description: "List" },
  tool_use_id: "toolu_1",
});

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

async function run(home: string, env: Record<string, string> = {}, stdin = PAYLOAD): Promise<Run> {
  const proc = Bun.spawn(["/bin/sh", SCRIPT], {
    stdin: new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      // A fake home: nothing may be written under its .claude.
      HOME: home,
      GRAVITA_HOME: join(home, ".gravita"),
      CLAUDE_PLUGIN_ROOT: PLUGIN,
      ...env,
    },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

async function writeRuntime(home: string, content: string) {
  await mkdir(join(home, ".gravita"), { recursive: true, mode: 0o700 });
  await writeFile(join(home, ".gravita", "runtime.json"), content, { mode: 0o600 });
}

const spoolOf = (home: string) => join(home, ".gravita", "spool", "hooks.jsonl");

async function spooled(home: string): Promise<Record<string, unknown>[]> {
  const text = await readFile(spoolOf(home), "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

function expectSilentSuccess(r: Run) {
  expect(r).toEqual({ code: 0, stdout: "", stderr: "" });
}

describe("deep-observe forward.sh", () => {
  test("posts the exact payload with the hook token as a Bearer header", async () => {
    await withTempDir(async (home) => {
      const got: {
        body: string;
        auth: string | null;
        type: string | null;
        origin: string | null;
      }[] = [];
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(req) {
          if (new URL(req.url).pathname !== "/hooks" || req.method !== "POST")
            return new Response("no", { status: 404 });
          got.push({
            body: await req.text(),
            auth: req.headers.get("authorization"),
            type: req.headers.get("content-type"),
            origin: req.headers.get("origin"),
          });
          return new Response(null, { status: 204 });
        },
      });
      try {
        await writeRuntime(
          home,
          JSON.stringify({ port: server.port, hookToken: TOKEN, pid: 1, version: "0.0.0" }),
        );
        expectSilentSuccess(await run(home));
        expect(got).toEqual([
          { body: PAYLOAD, auth: `Bearer ${TOKEN}`, type: "application/json", origin: null },
        ]);
        expect(await readdir(join(home, ".gravita"))).toEqual(["runtime.json"]);
      } finally {
        server.stop(true);
      }
    });
  });

  test("engine down: the hook is spooled as one line, owner-only", async () => {
    await withTempDir(async (home) => {
      const dead = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
      const port = dead.port;
      dead.stop(true);
      await writeRuntime(home, JSON.stringify({ port, hookToken: TOKEN, pid: 1, version: "x" }));
      const before = Math.floor(Date.now() / 1000);
      expectSilentSuccess(await run(home));
      expectSilentSuccess(await run(home, {}, `${PAYLOAD}\n`));
      const lines = await spooled(home);
      expect(lines).toHaveLength(2);
      for (const l of lines) {
        const { gravita_spooled_at, ...rest } = l;
        expect(rest).toEqual(JSON.parse(PAYLOAD));
        expect(gravita_spooled_at).toBeGreaterThanOrEqual(before);
      }
      expect((await stat(spoolOf(home))).mode & 0o777).toBe(0o600);
      expect((await stat(join(home, ".gravita", "spool"))).mode & 0o777).toBe(0o700);
      expect(await Bun.file(join(home, ".claude")).exists()).toBe(false);
    });
  });

  test("no runtime file, or a garbage one: spooled, still silent", async () => {
    await withTempDir(async (home) => {
      expectSilentSuccess(await run(home));
      await writeRuntime(home, 'this is not json {"port": "x"}');
      expectSilentSuccess(await run(home));
      expect(await spooled(home)).toHaveLength(2);
    });
  });

  test("GRAVITA_MANAGED=1: nothing is sent or spooled", async () => {
    await withTempDir(async (home) => {
      expectSilentSuccess(await run(home, { GRAVITA_MANAGED: "1" }));
      expect(await Bun.file(join(home, ".gravita")).exists()).toBe(false);
    });
  });

  test("empty input, or no curl on PATH: still exit 0 with no output", async () => {
    await withTempDir(async (home) => {
      expectSilentSuccess(await run(home, {}, ""));
      expect(await Bun.file(join(home, ".gravita")).exists()).toBe(false);
      // Only the shell's own tools: no curl, so the hook is spooled.
      const bin = join(home, "bin");
      await mkdir(bin);
      for (const tool of ["cat", "sed", "head", "tr", "wc", "date", "mkdir"]) {
        const path = Bun.which(tool);
        if (path) await symlink(path, join(bin, tool));
      }
      await writeRuntime(home, JSON.stringify({ port: 1, hookToken: TOKEN, pid: 1, version: "x" }));
      expectSilentSuccess(await run(home, { PATH: bin }));
      expect(await spooled(home)).toHaveLength(1);
    });
  });

  test("end to end: a real engine takes the hook through its runtime file", async () => {
    await withTempDir(async (home) => {
      const dataDir = join(home, ".gravita");
      const engine = startEngine({
        port: 0,
        demo: false,
        claudeHome: join(home, ".claude"),
        lookbackDays: 1,
        dataDir,
        devOrigins: [],
        token: "engine-token",
        detectClaude: async () => ({ found: false }),
        detectCodex: async () => ({ found: false }),
        codexHome: join(home, ".codex"),
      });
      try {
        const payload = JSON.stringify({
          session_id: "66666666-6666-4666-8666-666666666666",
          cwd: home,
          hook_event_name: "PreToolUse",
          tool_name: "Read",
          tool_input: { file_path: join(home, "a.txt") },
          tool_use_id: "toolu_e2e",
        });
        expectSilentSuccess(await run(home, {}, payload));
        expect(await Bun.file(spoolOf(home)).exists()).toBe(false);
        const res = await fetch(`http://127.0.0.1:${engine.port}/health`);
        expect(res.ok).toBe(true);
      } finally {
        await engine.stop();
      }
      expect(await Bun.file(join(home, ".claude")).exists()).toBe(false);
    });
  });
});
