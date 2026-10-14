import { describe, expect, test } from "bun:test";
import { BunPtyHost } from "../../src/infrastructure/terminal/bun-pty-host";

const host = new BunPtyHost();
const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", TERM: "xterm-256color" };

function run(script: string, o: { cols?: number; rows?: number } = {}) {
  let out = "";
  let resolveExit!: (code: number | null) => void;
  const exit = new Promise<number | null>((r) => {
    resolveExit = r;
  });
  const pty = host.spawn({
    argv: ["/bin/sh", "-c", script],
    cwd: "/tmp",
    env,
    cols: o.cols ?? 80,
    rows: o.rows ?? 24,
    onData: (t) => {
      out += t;
    },
    onExit: resolveExit,
  });
  return { pty, exit, out: () => out };
}

describe.skipIf(!host.supported)("BunPtyHost", () => {
  test("streams decoded output and the exit code, in a terminal of the given size", async () => {
    const r = run("printf 'hi ☃ '; stty size; exit 3", { cols: 100, rows: 30 });
    expect(await r.exit).toBe(3);
    expect(r.out()).toContain("hi ☃ 30 100");
  });

  test("takes input and resizes", async () => {
    const r = run("read line; stty size; echo got:$line");
    r.pty.resize(132, 40);
    r.pty.write("ping\r");
    expect(await r.exit).toBe(0);
    expect(r.out()).toContain("40 132");
    expect(r.out()).toContain("got:ping");
  });

  test("kill ends the process and what it started", async () => {
    const r = run("sleep 30 & sleep 30");
    await Bun.sleep(100);
    await r.pty.kill();
    expect(await r.exit).toBeNull();
  });
});
