import { join } from "node:path";
import { codexSessionId } from "@gravita/adapter-codex";
import { loadScript, ScriptedAppServer, type ScriptStep } from "@gravita/adapter-codex/testing";
import type { GravitaEvent } from "@gravita/protocol";
import type { IdGenerator } from "../src/application/ports/id-generator";
import type {
  AppServerLauncher,
  LaunchOptions,
} from "../src/infrastructure/codex/app-server-process";
import { CodexAccountProbe } from "../src/infrastructure/codex/codex-account-probe";
import { createCore, ENGINE_VERSION, type EngineCore } from "../src/main/container";
import { FakeClaudeEnvironment, FakeClock, FakeWorkspace, SilentLogger } from "./fakes";

export const RPC_FIXTURES = join(import.meta.dir, "../../../fixtures/codex-rpc/0.160");

/** The thread of a scenario (fixtures/codex-rpc: 0x401…), and its Gravita session. */
export const threadOf = (n: number) => `019a2b3c-0000-7000-8000-000000000${n.toString(16)}`;
export const sessionOf = (n: number) => codexSessionId(threadOf(n));

export const script = (scenario: string): ScriptStep[] =>
  loadScript(join(RPC_FIXTURES, `${scenario}.jsonl`));

/** UUIDs "00000000-0000-4000-8000-00000000000N", in order (the rollout fixture names #2). */
export class UuidIds implements IdGenerator {
  private n = 0;

  uuid(): string {
    this.n++;
    return `00000000-0000-4000-8000-${this.n.toString(16).padStart(12, "0")}`;
  }
}

/** Launches the next scripted app-server for each process Gravita starts. */
export class ScriptedLauncher {
  readonly servers: ScriptedAppServer[] = [];
  readonly launches: LaunchOptions[] = [];
  private readonly queue: ScriptStep[][] = [];

  constructor(...scripts: ScriptStep[][]) {
    this.queue.push(...scripts);
  }

  add(steps: ScriptStep[]) {
    this.queue.push(steps);
  }

  readonly launch: AppServerLauncher = (o) => {
    this.launches.push(o);
    const steps = this.queue.shift();
    if (!steps) throw new Error("no app-server script left");
    const server = new ScriptedAppServer(steps);
    this.servers.push(server);
    return { transport: server.transport, exited: server.exited, kill: () => server.kill() };
  };
}

/** A handshake-only script, for the account probe (its reads are answered ambiently). */
export const PROBE_SCRIPT: ScriptStep[] = [
  {
    expect: { method: "initialize" },
    result: {
      userAgent: "gravita/0.160.0 (synthetic)",
      codexHome: "/home/u/.codex",
      platformFamily: "unix",
      platformOs: "macos",
    },
  },
  { expect: { method: "initialized" } },
];

export const CODEX_ENV = {
  provider: "codex" as const,
  cliPath: "/opt/homebrew/bin/codex",
  cliVersion: "0.160.0",
  env: { PATH: "/usr/bin", HOME: "/home/u", OPENAI_BASE_URL: "https://proxy.local" },
};

/** A real-mode core whose Codex chats talk to scripted app-servers. */
export function codexChatCore(launcher: ScriptedLauncher, probe = new ScriptedLauncher()) {
  const clock = new FakeClock();
  const logger = new SilentLogger();
  const codexEnvironment = new FakeClaudeEnvironment(CODEX_ENV);
  const core = createCore({
    dbPath: ":memory:",
    demo: false,
    clock,
    logger,
    ids: new UuidIds(),
    codexHome: "/home/u/.codex",
    projectDirectory: {
      resolve: async (cwd) => ({ id: `p:${cwd}`, root: cwd, name: cwd.split("/").at(-1)! }),
    },
    chat: {
      environment: new FakeClaudeEnvironment(),
      codexEnvironment,
      codexLaunch: launcher.launch,
      codexProbe: new CodexAccountProbe({
        launch: probe.launch,
        shellEnv: async () => CODEX_ENV.env,
        version: ENGINE_VERSION,
        clock,
        logger,
      }),
      workspace: new FakeWorkspace(),
    },
  });
  return { core, clock, codexEnvironment };
}

/** RPC through the core's router: the result, or throws the RPC error. */
export async function call<T = { ok: true }>(
  core: EngineCore,
  method: string,
  params?: unknown,
): Promise<T> {
  const out = await core.router.dispatch(method, params);
  if ("error" in out) throw Object.assign(new Error(out.error.message), out.error);
  return out.result as T;
}

export function eventsOf(core: EngineCore, sessionId?: string): GravitaEvent[] {
  return [...core.events.allEvents()].filter((e) => !sessionId || e.sessionId === sessionId);
}

/** Waits (real time, a few seconds at most) until an event matches. */
export async function waitForEvent(
  core: EngineCore,
  pred: (e: GravitaEvent) => boolean,
  timeoutMs = 3_000,
): Promise<GravitaEvent> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const hit = eventsOf(core).find(pred);
    if (hit) return hit;
    if (Date.now() > until) throw new Error("timed out waiting for an event");
    await Bun.sleep(5);
  }
}
