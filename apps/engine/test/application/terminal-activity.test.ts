import { describe, expect, test } from "bun:test";
import type { TerminalUpdate } from "@gravita/protocol";
import type {
  ForegroundProbe,
  PtyProcess,
  PtySpawnOptions,
  TerminalHost,
} from "../../src/application/ports/terminal-host";
import { TerminalActivityWatcher } from "../../src/application/services/terminal-activity";
import { TerminalManager } from "../../src/application/services/terminal-manager";
import { providerOfCommand, providerOfCommands } from "../../src/domain/terminal-provider";
import { foregroundOf, parsePs } from "../../src/infrastructure/terminal/ps-foreground-probe";
import { FakeClock, SeqIds, SilentLogger } from "../fakes";

describe("providerOfCommand", () => {
  test("knows the three agents, started directly or through node", () => {
    expect(providerOfCommand("claude")).toBe("claude");
    expect(
      providerOfCommand("/Users/me/.local/share/claude/versions/2.1.296/claude --resume"),
    ).toBe("claude");
    expect(providerOfCommand("node /usr/lib/node_modules/@anthropic-ai/claude-code/cli.js")).toBe(
      "claude",
    );
    expect(providerOfCommand("codex --model gpt-5")).toBe("codex");
    expect(providerOfCommand("node /usr/lib/node_modules/@openai/codex/bin/codex.js")).toBe(
      "codex",
    );
    expect(providerOfCommand("/Users/me/.local/bin/cursor-agent")).toBe("cursor");
    expect(
      providerOfCommand(
        "/Users/me/.local/share/cursor-agent/versions/2026.10.14/node /Users/me/.local/share/cursor-agent/versions/2026.10.14/index.js",
      ),
    ).toBe("cursor");
  });

  test("judges by the program, not by its arguments", () => {
    expect(providerOfCommand("vim claude.md")).toBeUndefined();
    expect(providerOfCommand("grep codex /var/log/x")).toBeUndefined();
    expect(providerOfCommand("node server.js --name claude")).toBeUndefined();
    expect(providerOfCommand("-zsh")).toBeUndefined();
    expect(providerOfCommands(["-zsh", "claude"])).toBe("claude");
  });
});

describe("reading ps", () => {
  const out = [
    "  100   100   300 -zsh",
    "  300   300   300 claude --resume abc",
    "  301   300   300 node helper.js",
    "  200   200   200 -zsh",
    "  400   400     0 /usr/libexec/logd",
  ].join("\n");

  test("lists the foreground group of each shell", () => {
    const rows = parsePs(out);
    expect(rows).toHaveLength(5);
    const found = foregroundOf(rows, [100, 200, 999]);
    expect(found.get(100)).toEqual(["claude --resume abc", "node helper.js"]);
    expect(found.get(200)).toEqual(["-zsh"]);
    expect(found.has(999)).toBe(false);
  });
});

class Pty implements PtyProcess {
  constructor(
    readonly pid: number,
    readonly o: PtySpawnOptions,
  ) {}
  write() {}
  resize() {}
  async kill() {
    this.o.onExit(null);
  }
}

describe("TerminalActivityWatcher", () => {
  function setup() {
    let n = 0;
    const host: TerminalHost = { supported: true, spawn: (o) => new Pty(100 + n++, o) };
    const manager = new TerminalManager({
      host,
      clock: new FakeClock(),
      ids: new SeqIds(),
      logger: new SilentLogger(),
    });
    const updates: TerminalUpdate[] = [];
    manager.listen({ output: () => {}, update: (u) => updates.push(u) });
    const spec = (command: "shell" | "claude" = "shell") => ({
      command,
      cwd: "/work/demo",
      projectId: "p1",
      argv: ["/bin/zsh", "-l"],
      env: {},
      cols: 80,
      rows: 24,
    });
    const lines = new Map<number, string[]>();
    const probe: ForegroundProbe = { foreground: async () => lines };
    const watcher = new TerminalActivityWatcher(manager, probe, new SilentLogger());
    return { manager, updates, spec, lines, watcher };
  }

  test("marks a shell with the agent running in front, and clears it back at the prompt", async () => {
    const { manager, updates, spec, lines, watcher } = setup();
    const t = manager.spawn(spec());
    lines.set(100, ["cursor-agent"]);
    await watcher.tick();
    expect(manager.list()[0]?.activeProvider).toBe("cursor");

    const before = updates.length;
    await watcher.tick();
    expect(updates.length).toBe(before); // unchanged: nothing announced

    lines.set(100, ["-zsh"]);
    await watcher.tick();
    expect(manager.list()[0]?.activeProvider).toBeUndefined();
    expect(manager.list()[0]?.terminalId).toBe(t.terminalId);
    expect(updates.at(-1)).toMatchObject({ terminal: { terminalId: t.terminalId } });
  });

  test("leaves provider terminals alone and keeps what it knew when ps has no answer", async () => {
    const { manager, spec, lines, watcher } = setup();
    manager.spawn(spec("claude"));
    manager.spawn(spec());
    lines.set(100, ["codex"]);
    lines.set(101, ["claude"]);
    await watcher.tick();
    const [claudeTerminal, shell] = manager.list();
    expect(claudeTerminal?.activeProvider).toBeUndefined();
    expect(shell?.activeProvider).toBe("claude");

    lines.clear();
    await watcher.tick();
    expect(manager.list()[1]?.activeProvider).toBe("claude");
  });
});
