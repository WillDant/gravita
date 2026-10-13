import { describe, expect, test } from "bun:test";
import { mkdir, readFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { CheckRefusedError } from "../../src/domain/errors";
import {
  BunCheckRunner,
  CHECK_OUTPUT_CAP,
  checkEnv,
} from "../../src/infrastructure/checks/bun-check-runner";
import { withTempDir } from "../helpers";

// Checks run the agents' code: no shell, no secrets, never outside the worktree, and a
// timeout that kills the whole tree.

const T = 20_000;
const runner = (env: Record<string, string | undefined> = process.env) =>
  new BunCheckRunner({ env: () => env, killGraceMs: 200 });

describe("BunCheckRunner", () => {
  test(
    "runs argv without a shell: shell syntax reaches the program literally",
    async () => {
      await withTempDir(async (root) => {
        const o = await runner().run({
          argv: ["node", "-e", "console.log(process.argv[1])", "$(echo hi); echo pwned"],
          root,
          cwd: ".",
        });
        expect(o).toMatchObject({ ok: true, exitCode: 0, timedOut: false, missing: false });
        expect(o.output.trim()).toBe("$(echo hi); echo pwned");
      });
    },
    T,
  );

  test(
    "reports a red exit and keeps the output's tail",
    async () => {
      await withTempDir(async (root) => {
        // exitCode, not process.exit(): on Linux, Node writes to a pipe asynchronously and
        // exit() would drop most of the output before it reaches the runner. Everything
        // goes to stdout so its order is fixed; stdout and stderr interleave by arrival.
        const script =
          "for (let i = 0; i < 5000; i++) console.log('line ' + i); console.log('the end'); process.exitCode = 3";
        const o = await runner().run({ argv: ["node", "-e", script], root, cwd: "." });
        expect(o).toMatchObject({ ok: false, exitCode: 3, timedOut: false });
        expect(o.output.length).toBeLessThanOrEqual(CHECK_OUTPUT_CAP);
        expect(o.output).toContain("line 4999");
        expect(o.output).toContain("the end");
        expect(o.output).not.toContain("line 0\n");
      });
    },
    T,
  );

  test(
    "runs in the check's folder inside the worktree",
    async () => {
      await withTempDir(async (root) => {
        await mkdir(join(root, "apps", "api"), { recursive: true });
        const o = await runner().run({
          argv: ["node", "-e", "console.log(process.cwd())"],
          root,
          cwd: "apps/api",
        });
        expect(o.output.trim().endsWith(join("apps", "api"))).toBe(true);
      });
    },
    T,
  );

  test(
    "refuses a folder outside the worktree, through .., an absolute path or a symlink",
    async () => {
      await withTempDir(async (tmp) => {
        const root = join(tmp, "wt");
        await mkdir(root);
        await mkdir(join(tmp, "outside"));
        await symlink(join(tmp, "outside"), join(root, "link"));
        const r = runner();
        const argv = ["node", "-e", "1"];
        for (const cwd of ["..", "../outside", "a/../../outside", tmp, "link", "missing"])
          await expect(r.run({ argv, root, cwd })).rejects.toBeInstanceOf(CheckRefusedError);
      });
    },
    T,
  );

  test(
    "refuses a program outside CHECK_PROGRAMS",
    async () => {
      await withTempDir(async (root) => {
        for (const argv of [["sh", "-c", "echo hi"], ["/bin/echo", "hi"], ["bash"]])
          await expect(runner().run({ argv, root, cwd: "." })).rejects.toBeInstanceOf(
            CheckRefusedError,
          );
      });
    },
    T,
  );

  test(
    "a program that isn't installed is reported as missing",
    async () => {
      await withTempDir(async (root) => {
        const o = await runner({ PATH: join(root, "empty-bin") }).run({
          argv: ["pnpm", "install"],
          root,
          cwd: ".",
        });
        expect(o).toMatchObject({ ok: false, missing: true, exitCode: null });
      });
    },
    T,
  );

  test(
    "a timeout kills the program and what it started",
    async () => {
      await withTempDir(async (root) => {
        // The child keeps stdout open: only killing the group ends the run.
        const script =
          "const c = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' }); require('fs').writeFileSync('child.pid', String(c.pid)); setInterval(() => {}, 1000)";
        const started = performance.now();
        const o = await runner().run({
          argv: ["node", "-e", script],
          root,
          cwd: ".",
          timeoutMs: 300,
        });
        expect(o).toMatchObject({ ok: false, timedOut: true, exitCode: null });
        expect(o.output).toContain("[timed out]");
        expect(performance.now() - started).toBeLessThan(5_000);
        const child = Number(await readFile(join(root, "child.pid"), "utf8"));
        await Bun.sleep(100);
        expect(() => process.kill(child, 0)).toThrow();
      });
    },
    T,
  );

  test("the environment is an allowlist: no secrets, CI on", async () => {
    const env = checkEnv({
      PATH: "/bin",
      HOME: "/home/u",
      LC_CTYPE: "UTF-8",
      PNPM_HOME: "/pnpm",
      NPM_TOKEN: "npm_secret",
      GITHUB_TOKEN: "ghp_secret",
      ANTHROPIC_API_KEY: "sk-ant",
      AWS_SECRET_ACCESS_KEY: "aws",
      SSH_AUTH_SOCK: "/tmp/ssh",
      GRAVITA_TOKEN: "engine",
    });
    expect(env).toEqual({
      PATH: "/bin",
      HOME: "/home/u",
      LC_CTYPE: "UTF-8",
      PNPM_HOME: "/pnpm",
      CI: "1",
      NO_COLOR: "1",
      FORCE_COLOR: "0",
      HUSKY: "0",
      COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
      GIT_TERMINAL_PROMPT: "0",
    });
    await withTempDir(async (root) => {
      const o = await runner({ ...process.env, NPM_TOKEN: "npm_secret" }).run({
        argv: ["node", "-e", "console.log(process.env.NPM_TOKEN ?? 'none', process.env.CI)"],
        root,
        cwd: ".",
      });
      expect(o.output.trim()).toBe("none 1");
    });
  });
});
