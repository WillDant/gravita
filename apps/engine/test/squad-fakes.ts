import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  HookCallbackMatcher,
  Options,
  Query,
  SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { SquadState } from "@gravita/core";
import type { GravitaEvent, RpcParams } from "@gravita/protocol";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { SquadOrchestrator } from "../src/application/squad/squad-orchestrator";
import type { QueryFn } from "../src/infrastructure/claude/sdk/claude-sdk-runtime";
import { CodexAccountProbe } from "../src/infrastructure/codex/codex-account-probe";
import { createCore, ENGINE_VERSION, type EngineCore } from "../src/main/container";
import { type CodexScript, type FakeCodex, fakeCodexLauncher, serveMcp } from "./codex-squad-fakes";
import { FakeClaudeEnvironment, FakeClock, SeqIds, SilentLogger } from "./fakes";
import { isolatedEnv } from "./git-helpers";
import { ScriptedQuery } from "./sdk-fakes";

// A scripted "model" for squads: each Claude Code session the engine starts gets a
// ScriptedAgent, and a test script decides what it does — write files in its worktree, call
// Gravita's role tools through the real in-process MCP server, end its turns. Nothing runs
// Claude Code, so it costs nothing; git, the merge queue and the checks are all real.

let resultSeq = 0;

export class ScriptedAgent {
  private client: Client | undefined;
  /** The session's cumulative cost so far (results repeat it unless told otherwise). */
  private cost = 0;
  /** Runs when the engine interrupts the turn; by default the turn ends as an error. */
  onInterrupt: () => void = () => this.result({ subtype: "error_during_execution" });

  constructor(readonly q: ScriptedQuery) {}

  get options(): Options {
    return this.q.options;
  }

  get cwd(): string {
    return this.options.cwd ?? "";
  }

  /** A planning run: it answers with a plan as structured output. */
  get isPlanner(): boolean {
    return this.options.outputFormat !== undefined;
  }

  /** The briefing conversation: the planner role talking with the user, before any plan. */
  get isBriefing(): boolean {
    return !this.isPlanner && !this.isRole;
  }

  /** A role's task session (it has Gravita's role tools). */
  get isRole(): boolean {
    return this.options.mcpServers?.gravita !== undefined;
  }

  /** The text of the n-th message Gravita sent (1-based), once it arrives. */
  async prompt(n = 1): Promise<string> {
    await this.q.waitForPrompts(n);
    const content = this.q.prompts[n - 1]?.message.content;
    return typeof content === "string" ? content : JSON.stringify(content);
  }

  /** The task id of a role session, from its first message. */
  async taskId(): Promise<string> {
    const m = /Your task: .* \(([a-z0-9-]+)\)/.exec(await this.prompt(1));
    if (!m?.[1]) throw new Error("not a role session");
    return m[1];
  }

  /** Calls one of Gravita's role tools through the session's MCP server. */
  async tool(name: string, args: Record<string, unknown> = {}) {
    if (!this.client) {
      const server = this.options.mcpServers?.gravita as { instance?: unknown } | undefined;
      if (!server?.instance) throw new Error("no gravita MCP server in this session");
      const [ours, theirs] = InMemoryTransport.createLinkedPair();
      await (server.instance as { connect(t: unknown): Promise<void> }).connect(ours);
      this.client = new Client({ name: "scripted-agent", version: "1" });
      await this.client.connect(theirs);
    }
    const r = (await this.client.callTool({ name, arguments: args })) as {
      content: { type: string; text?: string }[];
      isError?: boolean;
    };
    return { text: r.content.map((c) => c.text ?? "").join(""), isError: r.isError === true };
  }

  /** Runs the session's PreToolUse hooks on a tool call, like Claude Code would. */
  async preToolUse(toolName: string, toolInput: Record<string, unknown>, agentId?: string) {
    const matchers = (this.options.hooks?.PreToolUse ?? []) as HookCallbackMatcher[];
    for (const m of matchers) {
      if (m.matcher && !new RegExp(`^(${m.matcher})$`).test(toolName)) continue;
      for (const hook of m.hooks) {
        const out = (await hook(
          {
            hook_event_name: "PreToolUse",
            tool_name: toolName,
            tool_input: toolInput,
            tool_use_id: "toolu_hook",
            session_id: this.options.sessionId ?? "",
            transcript_path: "",
            cwd: this.cwd,
            ...(agentId ? { agent_id: agentId, agent_type: "general-purpose" } : {}),
          },
          "toolu_hook",
          { signal: new AbortController().signal },
        )) as {
          hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string };
        };
        if (out.hookSpecificOutput?.permissionDecision === "deny")
          return out.hookSpecificOutput.permissionDecisionReason;
      }
    }
    return undefined;
  }

  async write(files: Record<string, string>) {
    for (const [path, text] of Object.entries(files)) {
      await mkdir(dirname(join(this.cwd, path)), { recursive: true });
      await writeFile(join(this.cwd, path), text);
    }
  }

  /** Ends the current turn. `cost` is the session's cumulative cost. */
  result(o: { subtype?: string; cost?: number; structured?: unknown; errors?: string[] } = {}) {
    const subtype = o.subtype ?? "success";
    this.cost = o.cost ?? this.cost;
    this.q.emit({
      type: "result",
      subtype,
      is_error: subtype !== "success",
      duration_ms: 10,
      duration_api_ms: 5,
      num_turns: 1,
      stop_reason: null,
      total_cost_usd: this.cost,
      usage: {},
      modelUsage: {},
      permission_denials: [],
      uuid: `00000000-0000-4000-8000-${String(++resultSeq).padStart(12, "0")}`,
      session_id: this.options.sessionId ?? "",
      ...(subtype === "success" ? { result: "", structured_output: o.structured } : {}),
      ...(o.errors ? { errors: o.errors } : {}),
    } as unknown as SDKMessage);
  }
}

export type AgentScript = (agent: ScriptedAgent) => Promise<void>;

/** A QueryFn whose sessions are played by `script`; failures of the script are collected. */
export function squadQueryFn(script: AgentScript) {
  const agents: ScriptedAgent[] = [];
  const failures: unknown[] = [];
  const queryFn: QueryFn = (params) => {
    const q = new ScriptedQuery(params);
    const agent = new ScriptedAgent(q);
    const interrupt = q.interrupt.bind(q);
    q.interrupt = async () => {
      await interrupt();
      agent.onInterrupt();
      return undefined;
    };
    agents.push(agent);
    void script(agent).catch((err) => failures.push(err));
    return q as unknown as Query;
  };
  return { queryFn, agents, failures };
}

/** A clock whose every timestamp is a millisecond later, so event order is visible in ts. */
export class TickingClock extends FakeClock {
  override iso(): string {
    this.t += 1;
    return super.iso();
  }
}

/** Codex as squads see it in tests: the CLI found, an allowlisted env. */
export const FAKE_CODEX_ENV = {
  provider: "codex" as const,
  cliPath: "/opt/homebrew/bin/codex",
  cliVersion: "0.160.0",
  env: {
    PATH: "/usr/bin",
    HOME: "/home/u",
    CODEX_HOME: "/home/u/.codex",
    OPENAI_API_KEY: "sk-user-own",
    OPENAI_BASE_URL: "https://proxy.local",
  },
};

/**
 * A real-mode core whose Claude Code sessions are scripted, with git in `tmp`. With
 * `codex`, Codex is there too: its app-servers are FakeCodex agents played by that script,
 * squads run them in `<tmp>/data/codex-home`, and the role tools' MCP route listens on a
 * real loopback port (call `stop` at the end).
 */
export function squadCore(
  tmp: string,
  script: AgentScript,
  o: { dbPath?: string; codex?: CodexScript } = {},
) {
  const env = isolatedEnv(join(tmp, "home"));
  const { queryFn, agents, failures } = squadQueryFn(script);
  const clock = new TickingClock();
  const logger = new SilentLogger();
  const codex = o.codex ? fakeCodexLauncher(o.codex) : undefined;
  const probe = fakeCodexLauncher(async () => {});
  const codexHome = join(tmp, "data", "codex-home");
  const core: EngineCore = createCore({
    dbPath: o.dbPath ?? ":memory:",
    demo: false,
    clock,
    logger,
    ids: new SeqIds(),
    projectDirectory: { resolve: async (cwd) => ({ id: "p1", root: cwd, name: "demo" }) },
    chat: {
      environment: new FakeClaudeEnvironment(),
      queryFn,
      ...(codex
        ? {
            codexEnvironment: new FakeClaudeEnvironment(FAKE_CODEX_ENV),
            codexLaunch: codex.launch,
            codexSquadHome: codexHome,
            codexProbe: new CodexAccountProbe({
              launch: probe.launch,
              shellEnv: async () => FAKE_CODEX_ENV.env,
              version: ENGINE_VERSION,
              clock,
              logger,
            }),
          }
        : {}),
    },
    squad: {
      worktreesRoot: join(tmp, "data", "worktrees"),
      env,
      checkEnv: () => env,
      lockfileCommands: {},
    },
  });
  const squads = core.squads;
  if (!squads) throw new Error("no orchestrator");
  const squad = (id: string): SquadState => {
    const q = core.projection.squad(id);
    if (!q) throw new Error(`no squad ${id}`);
    return q;
  };
  const events = (type?: string): GravitaEvent[] =>
    [...core.events.allEvents()].filter((e) => !type || e.type === type);
  const mcp = core.mcp ? serveMcp(core.mcp) : undefined;
  // The profile exists (its sign-in is up to each fake app-server's account read).
  core.codexProfile?.prepare();
  const codexAgents: FakeCodex[] = codex?.agents ?? [];
  return {
    core,
    squads,
    squad,
    events,
    agents,
    failures,
    clock,
    logger,
    env,
    codexAgents,
    codexFailures: codex?.failures ?? [],
    codexHome,
    stop: () => mcp?.stop(),
  };
}

/** Creates a squad and asks for its plan at once (the briefing says nothing). */
export async function createAndPlan(
  h: { squads: SquadOrchestrator },
  p: RpcParams<"squad.create">,
): Promise<{ squadId: string; projectId: string }> {
  const created = await h.squads.create(p);
  h.squads.plan({ squadId: created.squadId });
  await h.squads.idle(created.squadId);
  return created;
}

/** Polls until `pred` holds (the engine works in the background). */
export async function until(pred: () => boolean, what = "condition", ms = 10_000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}
