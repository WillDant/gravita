import { cursorSessionId } from "@gravita/adapter-cursor";
import {
  cursorAcpScript,
  ScriptedAcpServer,
  type ScriptStep,
} from "@gravita/adapter-cursor/testing";
import type {
  CursorKeyCheck,
  CursorKeyValidator,
} from "../src/application/ports/credential-source";
import type {
  AppServerLauncher,
  LaunchOptions,
} from "../src/infrastructure/codex/app-server-process";
import { MemoryCredentialSource } from "../src/infrastructure/credentials/memory-credential-source";
import { createCore } from "../src/main/container";
import { UuidIds } from "./codex-rpc-helpers";
import { FakeClaudeEnvironment, FakeClock, FakeWorkspace, SilentLogger } from "./fakes";

/** The key the tests paste (synthetic: it must never appear in an event). */
export const TEST_KEY = "crsr_test_SENTINEL_0123456789abcdef";

/** The ACP session of a scenario (fixtures/cursor-acp: …0001…0007), and its Gravita session. */
export const acpSessionOf = (n: number) => `5e55c0de-0000-4000-8000-00000000000${n}`;
export const cursorSessionOf = (n: number) => cursorSessionId(acpSessionOf(n));

export const cursorScript = (scenario: string): ScriptStep[] => cursorAcpScript(scenario);

/** Launches the next scripted `cursor-agent acp` for each process Gravita starts. */
export class CursorLauncher {
  readonly servers: ScriptedAcpServer[] = [];
  readonly launches: LaunchOptions[] = [];
  private readonly queue: ScriptStep[][] = [];

  constructor(...scripts: ScriptStep[][]) {
    this.queue.push(...scripts);
  }

  readonly launch: AppServerLauncher = (o) => {
    this.launches.push(o);
    const steps = this.queue.shift();
    if (!steps) throw new Error("no cursor-agent script left");
    const server = new ScriptedAcpServer(steps);
    this.servers.push(server);
    return { transport: server.transport, exited: server.exited, kill: () => server.kill() };
  };
}

/** A key check that answers what the test says, and counts the keys it saw. */
export class FakeKeyValidator implements CursorKeyValidator {
  readonly seen: string[] = [];

  constructor(public answer: CursorKeyCheck = "valid") {}

  async validate(key: string): Promise<CursorKeyCheck> {
    this.seen.push(key);
    return this.answer;
  }
}

/** The shell's env as Cursor would find it, with a login of the user's own to keep out. */
export const CURSOR_ENV = {
  provider: "cursor" as const,
  cliPath: "/home/u/.local/bin/cursor-agent",
  cliVersion: "2026.10.14",
  env: {
    PATH: "/usr/bin",
    HOME: "/home/u",
    HTTPS_PROXY: "http://proxy.local:3128",
    CURSOR_API_KEY: "crsr_shell_key_of_the_user",
    CURSOR_AUTH_TOKEN: "token-of-the-user",
    CURSOR_API_ENDPOINT: "https://elsewhere.example",
    AGENT_CLI_CREDENTIAL_STORE: "keychain",
    OPENAI_API_KEY: "sk-not-for-cursor",
  },
};

/** A real-mode core whose Cursor chats talk to scripted `cursor-agent acp` processes. */
export function cursorChatCore(
  launcher: CursorLauncher,
  o: { key?: string | null; validator?: FakeKeyValidator } = {},
) {
  const clock = new FakeClock();
  const logger = new SilentLogger();
  const credentials = new MemoryCredentialSource(o.key === null ? undefined : (o.key ?? TEST_KEY));
  const validator = o.validator ?? new FakeKeyValidator();
  const core = createCore({
    dbPath: ":memory:",
    demo: false,
    clock,
    logger,
    ids: new UuidIds(),
    projectDirectory: {
      resolve: async (cwd) => ({ id: `p:${cwd}`, root: cwd, name: cwd.split("/").at(-1)! }),
    },
    chat: {
      environment: new FakeClaudeEnvironment(),
      cursorEnvironment: new FakeClaudeEnvironment(CURSOR_ENV),
      cursorLaunch: launcher.launch,
      credentials,
      cursorValidator: validator,
      workspace: new FakeWorkspace(),
    },
  });
  return { core, clock, credentials, validator, logger };
}
