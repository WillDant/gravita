import { describe, expect, test } from "bun:test";
import type { GravitaEvent, TerminalUpdate } from "@gravita/protocol";
import type {
  PtyProcess,
  PtySpawnOptions,
  TerminalHost,
} from "../../src/application/ports/terminal-host";
import { EventBroadcaster } from "../../src/application/services/event-broadcaster";
import { ProjectionService } from "../../src/application/services/projection-service";
import { RuntimeFactoryRegistry } from "../../src/application/services/runtime-factory-registry";
import {
  OUTPUT_BATCH_MS,
  OUTPUT_CHUNK_CHARS,
  TerminalManager,
  trimScrollback,
} from "../../src/application/services/terminal-manager";
import { TerminalSessionLinker } from "../../src/application/services/terminal-session-linker";
import { AnnounceProject } from "../../src/application/usecases/announce-project";
import { IngestEvents } from "../../src/application/usecases/ingest-events";
import { SpawnTerminal } from "../../src/application/usecases/spawn-terminal";
import {
  InvalidCwdError,
  InvalidSessionModeError,
  TerminalUnsupportedError,
  TooManyTerminalsError,
} from "../../src/domain/errors";
import { providerTerminalFlags } from "../../src/infrastructure/terminal/provider-terminal-flags";
import {
  FakeChatFactory,
  FakeClaudeEnvironment,
  FakeClock,
  FakeWorkspace,
  MemoryEventStore,
  SeqIds,
  SilentLogger,
} from "../fakes";

class FakePty implements PtyProcess {
  readonly written: string[] = [];
  size?: [number, number];
  killed = false;
  constructor(
    readonly pid: number,
    readonly o: PtySpawnOptions,
  ) {}
  write(data: string) {
    this.written.push(data);
  }
  resize(cols: number, rows: number) {
    this.size = [cols, rows];
  }
  async kill() {
    this.killed = true;
    this.o.onExit(null);
  }
}

class FakeHost implements TerminalHost {
  readonly spawned: FakePty[] = [];
  constructor(readonly supported = true) {}
  spawn(o: PtySpawnOptions): PtyProcess {
    const p = new FakePty(100 + this.spawned.length, o);
    this.spawned.push(p);
    return p;
  }
}

function setup(o: { supported?: boolean; max?: number } = {}) {
  const clock = new FakeClock();
  const host = new FakeHost(o.supported);
  const manager = new TerminalManager({
    host,
    clock,
    ids: new SeqIds(),
    logger: new SilentLogger(),
    ...(o.max ? { max: o.max } : {}),
  });
  const outputs: { id: string; data: string }[] = [];
  const updates: TerminalUpdate[] = [];
  manager.listen({
    output: (id, data) => outputs.push({ id, data }),
    update: (u) => updates.push(u),
  });
  const spec = (over: Partial<Parameters<TerminalManager["spawn"]>[0]> = {}) => ({
    command: "shell" as const,
    cwd: "/work/demo",
    projectId: "p1",
    argv: ["/bin/zsh", "-l"],
    env: {},
    cols: 80,
    rows: 24,
    ...over,
  });
  return { clock, host, manager, outputs, updates, spec };
}

describe("TerminalManager", () => {
  test("batches output into one message per frame, split under the frame limit", () => {
    const { clock, host, manager, outputs, spec } = setup();
    const t = manager.spawn(spec());
    const pty = host.spawned[0]!;
    pty.o.onData("a");
    pty.o.onData("b");
    expect(outputs).toEqual([]);
    clock.advance(OUTPUT_BATCH_MS);
    expect(outputs).toEqual([{ id: t.terminalId, data: "ab" }]);

    pty.o.onData("x".repeat(OUTPUT_CHUNK_CHARS + 5));
    expect(outputs.slice(1).map((o) => o.data.length)).toEqual([OUTPUT_CHUNK_CHARS, 5]);
  });

  test("keeps what was printed for a client that attaches later", () => {
    const { host, manager, spec } = setup();
    const t = manager.spawn(spec());
    host.spawned[0]!.o.onData("hello\r\n");
    host.spawned[0]!.o.onData("world");
    expect(manager.attach(t.terminalId).scrollback).toBe("hello\r\nworld");
  });

  test("trims kept output from a line start", () => {
    const chunks = ["aaaa\nbbbb\n", "cc"];
    const total = trimScrollback(chunks, 12, 7);
    expect(chunks.join("")).toBe("bbbb\ncc");
    expect(total).toBe(7);
  });

  test("writes and resizes the running process, reports its exit and forgets it on kill", async () => {
    const { host, manager, updates, spec } = setup();
    const t = manager.spawn(spec());
    manager.write(t.terminalId, "ls\r");
    manager.resize(t.terminalId, 120, 40);
    expect(host.spawned[0]!.written).toEqual(["ls\r"]);
    expect(host.spawned[0]!.size).toEqual([120, 40]);

    host.spawned[0]!.o.onExit(3);
    expect(updates.at(-1)).toEqual({ terminal: { ...t, running: false, exitCode: 3 } });

    await manager.kill(t.terminalId);
    expect(updates.at(-1)).toEqual({ closed: t.terminalId });
    expect(manager.list()).toEqual([]);
  });

  test("ends every process on dispose", async () => {
    const { host, manager, spec } = setup();
    manager.spawn(spec());
    manager.spawn(spec());
    await manager.disposeAll();
    expect(host.spawned.every((p) => p.killed)).toBe(true);
    expect(manager.list()).toEqual([]);
  });

  test("refuses past its limit, and where there is no PTY", () => {
    const { manager, spec } = setup({ max: 1 });
    manager.spawn(spec());
    expect(() => manager.spawn(spec())).toThrow(TooManyTerminalsError);
    expect(() => setup({ supported: false }).manager.spawn(spec())).toThrow(
      TerminalUnsupportedError,
    );
  });
});

describe("TerminalSessionLinker", () => {
  const started = (sessionId: string, provider: "claude" | "codex", cwd: string, ts: string) =>
    ({
      key: `session:${sessionId}:started`,
      ts,
      source: "transcript",
      provider,
      projectId: "p1",
      sessionId,
      type: "session.started",
      data: { kind: "external", cwd },
    }) as GravitaEvent;

  test("links the newest open terminal in the session's folder, once", () => {
    const { clock, manager, spec } = setup();
    const shell = manager.spawn(spec());
    clock.advance(1_000);
    const codex = manager.spawn(spec({ command: "codex" }));
    const linker = new TerminalSessionLinker(manager);
    const later = new Date(clock.now() + 5_000).toISOString();

    linker.observe([started("codex:t1", "codex", "/work/demo/", later)]);
    expect(manager.list().find((t) => t.terminalId === codex.terminalId)?.sessionId).toBe(
      "codex:t1",
    );
    // A Claude session can only be the shell's (the Codex terminal runs Codex).
    linker.observe([started("c1", "claude", "/work/demo", later)]);
    expect(manager.list().find((t) => t.terminalId === shell.terminalId)?.sessionId).toBe("c1");
    // Both are taken now.
    linker.observe([started("c2", "claude", "/work/demo", later)]);
    expect(manager.list().map((t) => t.sessionId)).toEqual(["c1", "codex:t1"]);
  });

  test("ignores sessions that started before the terminal, or elsewhere", () => {
    const { clock, manager, spec } = setup();
    manager.spawn(spec());
    const linker = new TerminalSessionLinker(manager);
    linker.observe([
      started("old", "claude", "/work/demo", new Date(clock.now() - 60_000).toISOString()),
      started("other", "claude", "/work/other", new Date(clock.now() + 1_000).toISOString()),
    ]);
    expect(manager.list()[0]?.sessionId).toBeUndefined();
  });
});

describe("SpawnTerminal", () => {
  function spawning(o: { supported?: boolean } = {}) {
    const base = setup(o);
    const store = new MemoryEventStore();
    const projection = new ProjectionService();
    const broadcaster = new EventBroadcaster(base.clock, {
      providers: {},
      indexing: { done: 0, total: 0 },
      demo: false,
    });
    const ingest = new IngestEvents(store, projection, broadcaster);
    const environment = new FakeClaudeEnvironment();
    const spawn = new SpawnTerminal({
      terminals: base.manager,
      workspace: new FakeWorkspace(),
      projects: new AnnounceProject(
        { resolve: async (cwd) => ({ id: "p1", root: cwd, name: "demo" }) },
        ingest,
        base.clock,
      ),
      shellEnv: async () => ({ PATH: "/usr/bin", SHELL: "/bin/zsh" }),
      defaultShell: "/bin/sh",
      providers: new RuntimeFactoryRegistry({
        claude: { factory: new FakeChatFactory({} as never), environment },
      }),
      flags: providerTerminalFlags,
      ids: new SeqIds(),
      clock: base.clock,
    });
    return { ...base, spawn };
  }

  test("starts Claude Code with a session id of its own, so the terminal is linked at once", async () => {
    const { spawn, host } = spawning();
    const t = await spawn.execute({
      cwd: "/work/demo",
      command: "claude",
      cols: 80,
      rows: 24,
      permissionMode: "acceptEdits",
    });
    expect(t.sessionId).toBe("id-1");
    const { argv, env, cwd } = host.spawned[0]!.o;
    expect(argv.slice(4)).toEqual([
      "/bin/claude",
      "--session-id",
      "id-1",
      "--permission-mode",
      "acceptEdits",
    ]);
    expect(argv[0]).toBe("/bin/zsh");
    expect(cwd).toBe("/work/demo");
    expect(env.TERM).toBe("xterm-256color");
    expect(env.GRAVITA_MANAGED).toBeUndefined();
  });

  test("Claude Code's default mode passes no flag", async () => {
    const { spawn, host } = spawning();
    await spawn.execute({
      cwd: "/work/demo",
      command: "claude",
      cols: 80,
      rows: 24,
      permissionMode: "default",
    });
    expect(host.spawned[0]!.o.argv).not.toContain("--permission-mode");
  });

  test("refuses a missing folder and another provider's mode", async () => {
    const { spawn } = spawning();
    await expect(
      spawn.execute({ cwd: "/nope", command: "shell", cols: 80, rows: 24 }),
    ).rejects.toBeInstanceOf(InvalidCwdError);
    await expect(
      spawn.execute({
        cwd: "/work/demo",
        command: "claude",
        cols: 80,
        rows: 24,
        permissionMode: "fullAccess",
      }),
    ).rejects.toBeInstanceOf(InvalidSessionModeError);
  });

  test("a shell needs no provider and starts unlinked", async () => {
    const { spawn, host } = spawning();
    const t = await spawn.execute({ cwd: "/work/demo", command: "shell", cols: 80, rows: 24 });
    expect(t.sessionId).toBeUndefined();
    expect(host.spawned[0]!.o.argv).toEqual(["/bin/zsh", "-l"]);
  });
});

describe("providerTerminalFlags", () => {
  test("Codex modes become its approval and sandbox flags; ids lose their prefix to resume", () => {
    expect(providerTerminalFlags.modeArgs("codex", "workspace", "/w")).toEqual([
      "-a",
      "on-request",
      "-s",
      "workspace-write",
    ]);
    expect(providerTerminalFlags.resumeArg("codex", "codex:abc")).toBe("abc");
    expect(providerTerminalFlags.sessionIdOf("codex", "ABC")).toBe("codex:abc");
    expect(providerTerminalFlags.sessionIdOf("claude", "u-1")).toBe("u-1");
  });
});
