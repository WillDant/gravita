import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RpcTransport } from "@gravita/adapter-codex";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  AppServerLauncher,
  LaunchOptions,
} from "../src/infrastructure/codex/app-server-process";
import { MCP_TOKEN_ENV } from "../src/infrastructure/codex/codex-app-server-runtime";
import type { LoopbackMcpServer } from "../src/infrastructure/mcp/loopback-mcp-server";

// A scripted "Codex" for squads: each `codex app-server` the engine starts is a FakeCodex
// that answers the protocol like Codex 0.160 would, and a test script decides what its agent
// does — write files in its worktree, ask for approvals (with the paths a file change
// writes), call Gravita's role tools through the real loopback MCP route (with the real MCP
// client SDK, over HTTP), report plan usage, end its turns. Nothing runs Codex and nothing
// is spent; git, the merge queue and the checks stay real.

type Loose = Record<string, unknown>;

let seq = 0;
const uuid = (prefix: number) =>
  `019b0000-0000-7000-8000-${prefix.toString(16).padStart(4, "0")}${(++seq).toString(16).padStart(8, "0")}`;

/** The catalog `model/list` answers: one default model with three efforts. */
export const FAKE_MODELS = [
  {
    id: "gpt-6.1-sol",
    model: "gpt-6.1-sol",
    displayName: "GPT-6.1 Sol",
    description: "",
    hidden: false,
    isDefault: true,
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high"].map((e) => ({
      reasoningEffort: e,
      description: e,
    })),
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    modelSpecialty: null,
    inputModalities: ["text"],
    supportsPersonality: false,
    multiAgentVersion: null,
    additionalSpeedTiers: [],
    serviceTiers: [],
    defaultServiceTier: null,
    availableAccessPrograms: null,
  },
];

/** The plan windows `account/rateLimits/read` and its notifications report (percents). */
export function rateLimits(primary: number, secondary = 10) {
  return {
    limitId: "codex",
    limitName: null,
    normalModelSlug: null,
    primary: { usedPercent: primary, windowDurationMins: 300, resetsAt: 1791900000 },
    secondary: { usedPercent: secondary, windowDurationMins: 10080, resetsAt: 1792400000 },
    credits: null,
    individualLimit: null,
    spendControlReached: null,
    planType: "team",
    rateLimitReachedType: null,
  };
}

/** Lines to the client, with a way to end the stream. */
class Pipe implements AsyncIterable<string> {
  private readonly chunks: string[] = [];
  private waiter: (() => void) | undefined;
  private ended = false;

  push(chunk: string) {
    if (this.ended) return;
    this.chunks.push(chunk);
    this.waiter?.();
  }

  end() {
    this.ended = true;
    this.waiter?.();
  }

  async *[Symbol.asyncIterator]() {
    for (;;) {
      const next = this.chunks.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      if (this.ended) return;
      await new Promise<void>((r) => {
        this.waiter = r;
      });
      this.waiter = undefined;
    }
  }
}

/** One app-server the engine started, and the agent a test script plays in it. */
export class FakeCodex {
  readonly transport: RpcTransport;
  readonly exited: Promise<number>;
  /** Everything the engine sent, in order. */
  readonly received: Loose[] = [];
  threadId: string | undefined;
  /** The params of thread/start (or thread/resume). */
  threadParams: Loose | undefined;
  /** The params of each turn/start. */
  readonly turns: Loose[] = [];
  /** Texts of turn/steer messages. */
  readonly steers: string[] = [];
  activeTurn: string | undefined;
  /** False: account/read answers that nobody is signed in. */
  signedIn = true;
  /** The sign-in link `account/login/start` answers with. */
  authUrl = "https://auth.openai.com/oauth/authorize?client_id=codex&state=fake";
  /** The login id of the sign-in in progress. */
  loginId: string | undefined;
  /** True: `account/login/cancel` is never answered. */
  hangOnLoginCancel = false;
  /** What the engine answered to each approval asked, in order. */
  readonly answers: unknown[] = [];
  /** Runs when the engine interrupts the turn; by default the turn ends interrupted. */
  onInterrupt: () => void = () => this.endTurn("interrupted");
  private readonly out = new Pipe();
  private exit!: (code: number) => void;
  private closed = false;
  private readonly turnWaiters: (() => void)[] = [];
  private readonly pendingAsks = new Map<number, (result: unknown) => void>();
  private nextAsk = 1000;
  private mcp: Client | undefined;

  constructor(readonly launch: LaunchOptions) {
    this.exited = new Promise((r) => {
      this.exit = r;
    });
    this.transport = {
      incoming: this.out,
      send: (line) => this.fromClient(line),
      close: () => this.stop(0),
    };
  }

  get cwd(): string {
    return this.launch.cwd;
  }

  /** The value of a `-c key=value` override the engine started it with. */
  config(key: string): string | undefined {
    const args = this.launch.args ?? [];
    for (let i = 0; i < args.length - 1; i++)
      if (args[i] === "-c" && args[i + 1]?.startsWith(`${key}=`))
        return args[i + 1]!.slice(key.length + 1);
    return undefined;
  }

  /** A role's session: it has Gravita's role tools. */
  get isRole(): boolean {
    return this.config("mcp_servers.gravita.url") !== undefined;
  }

  get isPlanner(): boolean {
    return !this.isRole && this.turns.some((t) => t.outputSchema !== undefined);
  }

  /** Waits for the `n`-th turn (1-based) and returns its text. */
  async prompt(n = 1): Promise<string> {
    while (this.turns.length < n) await new Promise<void>((r) => this.turnWaiters.push(r));
    const input = this.turns[n - 1]?.input as { text?: string }[] | undefined;
    return input?.map((i) => i.text ?? "").join("") ?? "";
  }

  /** The task id of a role session, from its first message. */
  async taskId(): Promise<string> {
    const m = /Your task: .* \(([a-z0-9-]+)\)/.exec(await this.prompt(1));
    if (!m?.[1]) throw new Error("not a role session");
    return m[1];
  }

  async write(files: Record<string, string>) {
    for (const [path, text] of Object.entries(files)) {
      await mkdir(dirname(join(this.cwd, path)), { recursive: true });
      await writeFile(join(this.cwd, path), text);
    }
  }

  /** Asks to change files (paths as Codex names them): resolves with the engine's decision. */
  async requestFileChange(paths: string[]): Promise<unknown> {
    const itemId = uuid(1);
    this.notify("item/started", {
      threadId: this.threadId,
      turnId: this.activeTurn,
      item: {
        type: "fileChange",
        id: itemId,
        changes: paths.map((path) => ({ path, kind: { type: "add" }, diff: "+x\n" })),
        status: "inProgress",
      },
    });
    const r = (await this.ask("item/fileChange/requestApproval", {
      threadId: this.threadId,
      turnId: this.activeTurn,
      itemId,
      startedAtMs: 0,
    })) as { decision?: unknown };
    return r.decision;
  }

  /**
   * Asks to run a command (in a sandboxed session: one that wants out of the sandbox, as
   * an escalation does), `extra` being more of the request: resolves with the decision.
   */
  async requestCommand(command: string, extra: Loose = {}): Promise<unknown> {
    const r = (await this.ask("item/commandExecution/requestApproval", {
      kind: "command",
      threadId: this.threadId,
      turnId: this.activeTurn,
      itemId: uuid(2),
      startedAtMs: 0,
      environmentId: null,
      command,
      cwd: this.cwd,
      ...extra,
    })) as { decision?: unknown };
    return r.decision;
  }

  /** Asks for more permissions (network, file system): resolves with what was granted. */
  async requestPermissions(permissions: Loose, reason: string | null = null): Promise<unknown> {
    const r = (await this.ask("item/permissions/requestApproval", {
      threadId: this.threadId,
      turnId: this.activeTurn,
      itemId: uuid(7),
      environmentId: null,
      startedAtMs: 0,
      cwd: this.cwd,
      reason,
      permissions: { network: null, fileSystem: null, ...permissions },
    })) as { permissions?: unknown };
    return r.permissions;
  }

  /** Calls one of Gravita's role tools the way Codex does: MCP over the loopback URL. */
  async tool(name: string, args: Record<string, unknown> = {}) {
    if (!this.mcp) {
      const url = JSON.parse(this.config("mcp_servers.gravita.url") ?? '""') as string;
      const token = this.launch.env[MCP_TOKEN_ENV];
      const transport = new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      });
      this.mcp = new Client({ name: "codex-mcp-client", version: "0.160.0" });
      await this.mcp.connect(transport);
    }
    const r = (await this.mcp.callTool({ name, arguments: args })) as {
      content: { type: string; text?: string }[];
      isError?: boolean;
    };
    return { text: r.content.map((c) => c.text ?? "").join(""), isError: r.isError === true };
  }

  /** The tools Codex sees on the role's MCP server. */
  async listTools(): Promise<string[]> {
    await this.tool("whoami");
    const r = await this.mcp!.listTools();
    return r.tools.map((t) => t.name);
  }

  /** The agent's final message (the planner's plan, as JSON text). */
  say(text: string) {
    const id = uuid(3);
    this.notify("rawResponseItem/completed", {
      threadId: this.threadId,
      turnId: this.activeTurn,
      item: {
        type: "message",
        role: "assistant",
        id,
        content: [{ type: "output_text", text }],
      },
    });
  }

  /** Codex reports the plan's windows (`account/rateLimits/updated`). */
  usage(primary: number, secondary = 10) {
    this.notify("account/rateLimits/updated", { rateLimits: rateLimits(primary, secondary) });
  }

  endTurn(status: "completed" | "interrupted" | "failed" = "completed") {
    const id = this.activeTurn;
    if (!id) return;
    this.activeTurn = undefined;
    this.notify("turn/completed", {
      threadId: this.threadId,
      turn: {
        id,
        items: [],
        itemsView: "notLoaded",
        status,
        error: status === "failed" ? { message: "boom", codexErrorInfo: null } : null,
        startedAt: null,
        completedAt: null,
        durationMs: null,
      },
    });
  }

  /** The browser step of a sign-in ended (Codex took the callback, or it failed). */
  completeLogin(success: boolean, error?: string) {
    if (success) this.signedIn = true;
    this.notify("account/login/completed", {
      loginId: this.loginId ?? null,
      success,
      error: error ?? null,
      onboardingEntrypoint: null,
    });
  }

  /** The process dies (a crash). */
  crash() {
    this.stop(1);
  }

  private notify(method: string, params: unknown) {
    this.toClient({ method, params });
  }

  private ask(method: string, params: unknown): Promise<unknown> {
    const id = this.nextAsk++;
    return new Promise((resolve) => {
      this.pendingAsks.set(id, (result) => {
        this.answers.push(result);
        resolve(result);
      });
      this.toClient({ id, method, params });
    });
  }

  private toClient(msg: Loose) {
    this.out.push(`${JSON.stringify(msg)}\n`);
  }

  private stop(code: number) {
    if (this.closed) return;
    this.closed = true;
    this.out.end();
    this.exit(code);
  }

  private fromClient(line: string) {
    if (this.closed) return;
    const msg = JSON.parse(line) as Loose;
    this.received.push(msg);
    if (msg.method === undefined && typeof msg.id === "number") {
      this.pendingAsks.get(msg.id)?.(msg.result ?? msg.error);
      this.pendingAsks.delete(msg.id);
      return;
    }
    if (msg.id === undefined) return;
    const reply = (result: unknown) => this.toClient({ id: msg.id, result });
    const params = (msg.params ?? {}) as Loose;
    switch (msg.method) {
      case "initialize":
        return reply({
          userAgent: "gravita/0.160.0 (fake)",
          codexHome: this.launch.env.CODEX_HOME,
          platformFamily: "unix",
          platformOs: "macos",
        });
      case "account/read":
        return reply(
          this.signedIn
            ? {
                account: { type: "chatgpt", email: null, planType: "team" },
                requiresOpenaiAuth: true,
              }
            : { account: null, requiresOpenaiAuth: true },
        );
      case "model/list":
        return reply({ data: FAKE_MODELS, nextCursor: null });
      case "account/rateLimits/read":
        return reply({
          rateLimits: rateLimits(20),
          rateLimitsByLimitId: null,
          ordinaryUsageAllowed: true,
          rateLimitResetCredits: null,
          accountId: null,
          rateLimitUpsell: null,
        });
      case "thread/start":
      case "thread/resume": {
        this.threadParams = params;
        this.threadId =
          msg.method === "thread/resume" ? String(params.threadId) : (this.threadId ?? uuid(4));
        const thread = {
          id: this.threadId,
          path: null,
          cwd: params.cwd,
          model: "gpt-6.1-sol",
          turns: [],
        };
        return reply({ thread, model: "gpt-6.1-sol", reasoningEffort: "medium" });
      }
      case "turn/start": {
        const id = uuid(5);
        this.activeTurn = id;
        this.turns.push(params);
        reply({
          turn: { id, items: [], itemsView: "notLoaded", status: "inProgress", error: null },
        });
        this.notify("turn/started", {
          threadId: this.threadId,
          turn: { id, items: [], itemsView: "notLoaded", status: "inProgress", error: null },
        });
        for (const w of this.turnWaiters.splice(0)) w();
        return;
      }
      case "turn/steer": {
        const input = params.input as { text?: string }[] | undefined;
        this.steers.push(input?.map((i) => i.text ?? "").join("") ?? "");
        return reply({ turnId: this.activeTurn });
      }
      case "turn/interrupt":
        reply({});
        this.onInterrupt();
        return;
      case "account/login/start":
        this.loginId = uuid(6);
        return reply({ type: "chatgpt", loginId: this.loginId, authUrl: this.authUrl });
      case "account/login/cancel":
        // A Codex that never answers it: stopping the sign-in mustn't wait on it.
        if (this.hangOnLoginCancel) return;
        return reply({ status: "canceled" });
      case "account/logout":
        this.signedIn = false;
        return reply({});
      default:
        return this.toClient({
          id: msg.id,
          error: { code: -32601, message: `${String(msg.method)} not faked` },
        });
    }
  }
}

export type CodexScript = (agent: FakeCodex) => Promise<void>;

/** Starts a FakeCodex for each app-server, played by `script`; script failures are kept. */
export function fakeCodexLauncher(script: CodexScript) {
  const agents: FakeCodex[] = [];
  const failures: unknown[] = [];
  const launch: AppServerLauncher = (o) => {
    const agent = new FakeCodex(o);
    agents.push(agent);
    void script(agent).catch((err) => failures.push(err));
    return { transport: agent.transport, exited: agent.exited, kill: () => agent.crash() };
  };
  return { launch, agents, failures };
}

/** Serves the loopback MCP route on a real port, as the engine's transport does. */
export function serveMcp(mcp: LoopbackMcpServer): { port: number; stop(): void } {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (req, srv) => {
      if (new URL(req.url).pathname !== "/mcp") return new Response("Not found", { status: 404 });
      srv.timeout(req, 0);
      return mcp.handle(req);
    },
  });
  const port = server.port ?? 0;
  mcp.attach(port);
  return { port, stop: () => void server.stop(true) };
}
