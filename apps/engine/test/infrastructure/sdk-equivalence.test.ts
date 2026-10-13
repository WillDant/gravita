import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { readSession, SdkSessionMapper } from "@gravita/adapter-claude";
import { applyAll, emptyState, type GravitaState } from "@gravita/core";
import type { GravitaEvent } from "@gravita/protocol";
import { sdkFixture } from "../sdk-fakes";

// The same session seen through the Agent SDK stream and through its transcript must project
// to the same tree: who spawned whom, how each agent ended, and the tokens each one used.

const SID = "11111111-1111-4111-8111-111111111111";
const TRANSCRIPT = join(
  import.meta.dir,
  `../../../../fixtures/claude/2.1.296/nested-background/${SID}.jsonl`,
);

function sdkEvents(): GravitaEvent[] {
  const mapper = new SdkSessionMapper({
    projectId: "p1",
    sessionId: SID,
    now: () => "2026-10-12T10:05:00.000Z",
  });
  return sdkFixture("nested-background").flatMap((m) => mapper.map(m));
}

/** Dedupes by key in arrival order, as the event store does. */
function stored(events: GravitaEvent[]): GravitaEvent[] {
  const seen = new Set<string>();
  return events.filter((e) => {
    if (seen.has(e.key)) return false;
    seen.add(e.key);
    return true;
  });
}

function shape(state: GravitaState) {
  const s = state.sessions[SID]!;
  return Object.fromEntries(
    Object.values(s.agents)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((a) => [
        a.id,
        {
          parentId: a.parentId,
          depth: a.depth,
          agentType: a.agentType,
          background: a.background,
          children: [...a.children].sort(),
          lifecycle: a.lifecycle,
          tokens: a.tokens,
          toolCount: a.toolCount,
          filesTouched: a.filesTouched,
          inflight: Object.keys(a.inflight),
        },
      ]),
  );
}

describe("SDK stream ≡ transcript", () => {
  test("the projections agree on the tree, terminal statuses and tokens", async () => {
    const transcript = stored(await readSession(TRANSCRIPT, { projectId: "p1" }));
    const fromTranscript = shape(applyAll(emptyState(), transcript));
    const fromSdk = shape(applyAll(emptyState(), stored(sdkEvents())));
    expect(fromSdk).toEqual(fromTranscript);
    expect(fromSdk.a0000000000000003).toMatchObject({
      parentId: "a0000000000000002",
      lifecycle: "done",
    });
  });

  test("both sources together store each fact once and project the same", async () => {
    const transcript = await readSession(TRANSCRIPT, { projectId: "p1" });
    const sdk = sdkEvents();
    // As in a real run: Gravita records the first prompt, then the SDK streams, and the
    // transcript is read once the runtime is gone.
    const prompt = transcript.find((e) => e.key === "user:u1")!;
    const first = { ...prompt, source: "gravita", data: { ...prompt.data, origin: "gravita" } };
    const both = stored([first as GravitaEvent, ...sdk, ...transcript]);
    const transcriptOnly = stored(transcript);
    // Everything the transcript adds over the SDK is session metadata the SDK doesn't carry.
    const sdkKeys = new Set(sdk.map((e) => e.key));
    const extra = transcriptOnly.filter((e) => !sdkKeys.has(e.key)).map((e) => e.type as string);
    expect([...new Set(extra)].sort()).toEqual([
      "message.user",
      "session.started",
      "session.titled",
    ]);
    expect(shape(applyAll(emptyState(), both))).toEqual(
      shape(applyAll(emptyState(), transcriptOnly)),
    );
  });
});
