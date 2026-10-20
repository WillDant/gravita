import { describe, expect, test } from "bun:test";
import type { SDKControlGetContextUsageResponse } from "@anthropic-ai/claude-agent-sdk";
import type { ContextUsage } from "@gravita/protocol";
import { ProjectionService } from "../../src/application/services/projection-service";
import { InMemorySessionRuntimeRegistry } from "../../src/application/services/session-runtime-registry";
import { GetSessionContext } from "../../src/application/usecases/get-session-context";
import { IngestEvents } from "../../src/application/usecases/ingest-events";
import { toContextUsage } from "../../src/infrastructure/claude/sdk/context-usage";
import {
  FakeClock,
  FakeRuntime,
  MemoryEventStore,
  RecordingPublisher,
  SilentLogger,
} from "../fakes";

// The session's context panel: the breakdown asked of the runtime that runs the session.

const USAGE: ContextUsage = {
  model: "claude-opus-5-5",
  totalTokens: 42_000,
  maxTokens: 200_000,
  percentage: 21,
  categories: [{ name: "Messages", tokens: 30_000, kind: "used" }],
  memoryFiles: [],
  mcpTools: [],
  agents: [],
  autoCompact: false,
};

function setup() {
  const ingest = new IngestEvents(
    new MemoryEventStore(),
    new ProjectionService(),
    new RecordingPublisher(),
  );
  const clock = new FakeClock();
  const runtimes = new InMemorySessionRuntimeRegistry(ingest, clock);
  return { clock, runtimes, context: new GetSessionContext(runtimes, clock, new SilentLogger()) };
}

class ContextRuntime extends FakeRuntime {
  constructor(
    sessionId: string,
    readonly contextUsage: () => Promise<ContextUsage>,
  ) {
    super(sessionId);
  }
}

describe("GetSessionContext", () => {
  test("answers with the runtime's breakdown", async () => {
    const { runtimes, context } = setup();
    runtimes.register(new ContextRuntime("s1", async () => USAGE));
    expect(await context.execute({ sessionId: "s1" })).toEqual({ kind: "full", usage: USAGE });
  });

  test("a session Gravita doesn't run, or a runtime that can't tell, is unavailable", async () => {
    const { runtimes, context } = setup();
    runtimes.register(new FakeRuntime("plain"));
    expect(await context.execute({ sessionId: "nobody" })).toEqual({ kind: "unavailable" });
    expect(await context.execute({ sessionId: "plain" })).toEqual({ kind: "unavailable" });
  });

  test("a failing or slow runtime is unavailable", async () => {
    const { clock, runtimes, context } = setup();
    runtimes.register(new ContextRuntime("bad", () => Promise.reject(new Error("boom"))));
    expect(await context.execute({ sessionId: "bad" })).toEqual({ kind: "unavailable" });

    runtimes.register(new ContextRuntime("slow", () => new Promise(() => {})));
    const answer = context.execute({ sessionId: "slow" });
    clock.advance(10_000);
    expect(await answer).toEqual({ kind: "unavailable" });
  });
});

describe("toContextUsage", () => {
  test("maps the SDK's /context answer, keeping optional parts optional", () => {
    const sdk = {
      categories: [
        { name: "System prompt", tokens: 3000, color: "x", kind: "used" },
        {
          name: "MCP tools (deferred)",
          tokens: 900,
          color: "x",
          isDeferred: true,
          kind: "deferred",
        },
        { name: "Free space", tokens: 150_000, color: "x", kind: "free" },
      ],
      totalTokens: 47_000,
      maxTokens: 167_000,
      rawMaxTokens: 200_000,
      percentage: 24,
      gridRows: [],
      model: "claude-opus-5-5",
      memoryFiles: [{ path: "/work/p1/CLAUDE.md", type: "Project", tokens: 800 }],
      mcpTools: [{ name: "mcp__linear__list", serverName: "linear", tokens: 300, isLoaded: false }],
      agents: [{ agentType: "reviewer", source: "projectSettings", tokens: 120 }],
      isAutoCompactEnabled: true,
      autoCompactThreshold: 160_000,
    } as unknown as SDKControlGetContextUsageResponse;
    expect(toContextUsage(sdk)).toEqual({
      model: "claude-opus-5-5",
      totalTokens: 47_000,
      maxTokens: 200_000,
      percentage: 24,
      categories: [
        { name: "System prompt", tokens: 3000, kind: "used" },
        { name: "MCP tools (deferred)", tokens: 900, kind: "deferred" },
        { name: "Free space", tokens: 150_000, kind: "free" },
      ],
      memoryFiles: [{ path: "/work/p1/CLAUDE.md", type: "Project", tokens: 800 }],
      mcpTools: [{ name: "mcp__linear__list", serverName: "linear", tokens: 300, loaded: false }],
      agents: [{ agentType: "reviewer", source: "projectSettings", tokens: 120 }],
      autoCompactThreshold: 160_000,
      autoCompact: true,
    });
  });
});
