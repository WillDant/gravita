import { describe, expect, test } from "bun:test";
import { appendFile, copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyAll, emptyState } from "@gravita/core";
import { type EventOf, GravitaEvent } from "@gravita/protocol";
import fc from "fast-check";
import {
  CursorSessionTail,
  normalizedPrompt,
  parseTranscriptLine,
  transcriptTool,
  userQueryOf,
  visibleText,
} from "../src";

const FIXTURE = join(import.meta.dir, "../../../fixtures/cursor/2026.10.14/subagents");
const ROOT = "d14e9854-78f5-4d95-8616-e5b413d11ab5";
const CHILD = "0af03c5f-4a38-4782-8964-b2bbf55847cc";
const transcript = (chat: string) =>
  join(FIXTURE, "projects/work-demo/agent-transcripts", chat, `${chat}.jsonl`);

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "gravita-cursor-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const tailOf = (path: string, chatId = ROOT) =>
  new CursorSessionTail({
    chatId,
    path,
    projectId: "p1",
    cwd: "/work/demo",
    startedAt: "2026-10-14T22:07:37.354Z",
    title: "File Read And Create",
  });

const keysOf = (events: readonly GravitaEvent[]) => events.map((e) => e.key);
const ofType = <T extends GravitaEvent["type"]>(events: readonly GravitaEvent[], type: T) =>
  events.filter((e): e is EventOf<T> => e.type === type);

async function readAll(): Promise<GravitaEvent[]> {
  const tail = tailOf(transcript(ROOT));
  tail.addChildren([{ path: transcript(CHILD), chatId: CHILD, parentChatId: ROOT }]);
  return tail.poll();
}

describe("transcript records", () => {
  test("a user line is the query inside its timestamp wrapper", () => {
    const r = parseTranscriptLine(
      JSON.stringify({
        role: "user",
        message: {
          content: [{ type: "text", text: "<timestamp>x</timestamp>\n<user_query>\nfix it\n</user_query>" }],
        },
      }),
    );
    expect(r?.kind).toBe("user");
    expect(r?.kind === "user" && userQueryOf(r.text)).toBe("fix it");
  });

  test("broken or foreign lines are ignored, the end of a turn is read", () => {
    expect(parseTranscriptLine("{not json")).toBeUndefined();
    expect(parseTranscriptLine('{"role":"system","message":{}}')).toBeUndefined();
    expect(parseTranscriptLine('{"type":"turn_ended","status":"success"}')).toEqual({
      kind: "turn_ended",
      status: "success",
    });
  });

  test("redacted reasoning is not text, prompts compare without spacing", () => {
    expect(visibleText("[REDACTED]")).toBe("");
    expect(visibleText("done\n\n[REDACTED]")).toBe("done");
    expect(normalizedPrompt("a \n b")).toBe("a b");
  });
});

describe("transcriptTool", () => {
  test("names the agent's tools as Gravita's kinds", () => {
    const kind = (name: string, input = {}) => transcriptTool(name, input)?.kind;
    expect(kind("Read", { path: "/a" })).toBe("read");
    expect(kind("StrReplace")).toBe("edit");
    expect(kind("Write")).toBe("write");
    expect(kind("Shell", { command: "ls" })).toBe("bash");
    expect(kind("Grep")).toBe("search");
    expect(kind("TodoWrite")).toBe("todo");
    expect(kind("Mystery")).toBe("other");
  });

  test("a subagent is a Task behind CallDynamicTool; other dynamic tools are MCP; lookups vanish", () => {
    const task = transcriptTool("CallDynamicTool", {
      namespace: "cursor",
      toolName: "Task",
      arguments: { description: "Read it", subagent_type: "explore", prompt: "go" },
    });
    expect(task?.kind).toBe("agent");
    expect(task?.target.agentType).toBe("explore");
    expect(task?.task?.prompt).toBe("go");
    const mcp = transcriptTool("CallDynamicTool", { namespace: "gmail", toolName: "search" });
    expect(mcp).toMatchObject({ kind: "mcp", name: "mcp__gmail__search" });
    expect(transcriptTool("GetDynamicTools", {})).toBeUndefined();
  });
});

describe("CursorSessionTail", () => {
  test("a chat with a subagent becomes events every schema accepts", async () => {
    const events = await readAll();
    for (const e of events) GravitaEvent.parse(e);
    expect(new Set(keysOf(events)).size).toBe(events.length);
    expect(events.every((e) => e.provider === "cursor" && e.source === "cursor-transcript")).toBe(true);

    const [started] = ofType(events, "session.started");
    expect(events[0]).toBe(started);
    expect(started?.ts).toBe("2026-10-14T22:07:37.354Z");
    expect(started?.sessionId).toBe(`cursor:${ROOT}`);
    expect(started?.data).toMatchObject({ kind: "external", cwd: "/work/demo" });
    expect(ofType(events, "session.titled")[0]?.data.title).toBe("File Read And Create");

    const tools = ofType(events, "tool.started").filter((e) => e.agentId === "main");
    expect(tools.map((t) => [t.data.name, t.data.kind])).toEqual([
      ["Write", "write"],
      ["Task", "agent"],
    ]);
  });

  test("the subagent hangs under the task that started it", async () => {
    const events = await readAll();
    const [spawned] = ofType(events, "agent.spawned");
    const task = ofType(events, "tool.started").find((t) => t.data.name === "Task");
    expect(spawned?.agentId).toBe(`cursor:${CHILD}`);
    expect(spawned?.data).toMatchObject({
      parentAgentId: "main",
      spawnToolUseId: task?.data.toolUseId,
      agentType: "generalPurpose",
      description: "Ler hello.txt",
      depth: 1,
    });
    // The subagent's own work belongs to it, and it ends with its turn.
    const read = ofType(events, "tool.started").find((t) => t.data.name === "Read");
    expect(read?.agentId).toBe(`cursor:${CHILD}`);
    expect(ofType(events, "agent.completed")[0]).toMatchObject({
      agentId: `cursor:${CHILD}`,
      data: { status: "completed" },
    });
  });

  test("every call is closed once the agent moves on, and the turn ends", async () => {
    const events = await readAll();
    const started = ofType(events, "tool.started").map((t) => t.data.toolUseId);
    const completed = ofType(events, "tool.completed").map((t) => t.data.toolUseId);
    expect(completed.sort()).toEqual([...started].sort());
    expect(ofType(events, "turn.completed")).toHaveLength(1);
  });

  test("the lenses get what they need: an agent tree with nothing left running", async () => {
    const state = applyAll(emptyState(), await readAll());
    const session = Object.values(state.sessions)[0];
    expect(session?.provider).toBe("cursor");
    expect(session?.cwd).toBe("/work/demo");
    const agents = Object.values(session?.agents ?? {});
    expect(agents.map((a) => a.id).sort()).toEqual([`cursor:${CHILD}`, "main"]);
    expect(agents.find((a) => a.id === `cursor:${CHILD}`)?.parentId).toBe("main");
    expect(agents.every((a) => Object.keys(a.inflight).length === 0)).toBe(true);
  });

  test("random byte chunks across the files yield the same events as one read", async () => {
    const expected = new Set(keysOf(await readAll()));
    const files = [
      { chat: ROOT, bytes: await readFile(transcript(ROOT)) },
      { chat: CHILD, bytes: await readFile(transcript(CHILD)) },
    ];
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 1, max: 400 }), { minLength: 1, maxLength: 40 }),
        (sizes) =>
          withTempDir(async (dir) => {
            const paths = files.map((f) => join(dir, `${f.chat}.jsonl`));
            await Promise.all(paths.map((p) => writeFile(p, "")));
            const tail = tailOf(paths[0]!);
            tail.addChildren([{ path: paths[1]!, chatId: CHILD, parentChatId: ROOT }]);
            const seen: GravitaEvent[] = [];
            const done = files.map(() => 0);
            for (let i = 0; done.some((d, k) => d < files[k]!.bytes.length); i++) {
              const k = i % files.length;
              const size = sizes[i % sizes.length]!;
              const f = files[k]!;
              if (done[k]! < f.bytes.length) {
                await appendFile(paths[k]!, f.bytes.subarray(done[k], done[k]! + size));
                done[k]! += size;
              }
              seen.push(...(await tail.poll()));
            }
            seen.push(...(await tail.poll()));
            expect(new Set(keysOf(seen))).toEqual(expected);
            expect(new Set(keysOf(seen)).size).toBe(seen.length);
          }),
      ),
      { numRuns: 20 },
    );
  });

  test("an unfinished line waits, a finished last line without its newline does not", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, `${CHILD}.jsonl`);
      const user = JSON.stringify({
        role: "user",
        message: { content: [{ type: "text", text: "<user_query>\nhi\n</user_query>" }] },
      });
      const end = '{"type":"turn_ended","status":"success"}';
      await writeFile(path, `${user}\n${end.slice(0, 15)}`);
      const tail = tailOf(path, CHILD);
      expect(ofType(await tail.poll(), "turn.completed")).toHaveLength(0);
      await writeFile(path, `${user}\n${end}`);
      expect(ofType(await tail.poll(), "turn.completed")).toHaveLength(1);
      expect(await tail.poll()).toEqual([]);
    });
  });

  test("a restart from the checkpoint repeats nothing and goes on", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, `${ROOT}.jsonl`);
      await copyFile(transcript(ROOT), path);
      const first = tailOf(path);
      const before = await first.poll();
      expect(ofType(before, "session.started")).toHaveLength(1);

      const resumed = new CursorSessionTail({
        chatId: ROOT,
        path,
        projectId: "p1",
        cwd: "/work/demo",
        startedAt: "2026-10-14T22:07:37.354Z",
        checkpoint: JSON.parse(JSON.stringify(first.checkpoint())),
      });
      expect(await resumed.poll()).toEqual([]);
      await appendFile(
        path,
        `${JSON.stringify({ role: "user", message: { content: [{ type: "text", text: "<user_query>\nagain\n</user_query>" }] } })}\n`,
      );
      const more = await resumed.poll();
      expect(more.map((e) => e.type)).toEqual(["message.user"]);
      expect(keysOf(more).some((k) => keysOf(before).includes(k))).toBe(false);
    });
  });

  test("a turn that ends badly fails the calls it left open", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, `${ROOT}.jsonl`);
      const call = JSON.stringify({
        role: "assistant",
        message: { content: [{ type: "tool_use", name: "Shell", input: { command: "sleep 99" } }] },
      });
      await writeFile(path, `${call}\n${JSON.stringify({ type: "turn_ended", status: "error" })}\n`);
      const events = await tailOf(path).poll();
      expect(ofType(events, "tool.completed")[0]?.data).toMatchObject({ ok: false, error: "error" });
    });
  });

  test("whether a turn is open follows the file", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, `${ROOT}.jsonl`);
      const user = `${JSON.stringify({ role: "user", message: { content: [{ type: "text", text: "<user_query>\nhi\n</user_query>" }] } })}\n`;
      await writeFile(path, user);
      const tail = tailOf(path);
      await tail.poll();
      expect(tail.openTurn()).toBe(true);
      await appendFile(path, '{"type":"turn_ended","status":"success"}\n');
      await tail.poll();
      expect(tail.openTurn()).toBe(false);
    });
  });
});
