import { describe, expect, test } from "bun:test";
import type { EventOf } from "@gravita/protocol";
import { conversationOf, normalizeRecords, type RawRecord, stripInjected } from "../src";

const CTX = { projectId: "p1", sessionId: "s1", agentId: "main", filePath: "/t/s1.jsonl" };
const REMINDER = "<system-reminder>\nContext the host added.\n</system-reminder>";
const user = (uuid: string, content: NonNullable<RawRecord["message"]>["content"]): RawRecord => ({
  type: "user",
  uuid,
  timestamp: "2026-10-12T00:00:00.000Z",
  message: { role: "user", content },
});

const userMessages = (records: RawRecord[]) =>
  normalizeRecords(records, CTX).filter(
    (e): e is EventOf<"message.user"> => e.type === "message.user",
  );

describe("injected context in user turns", () => {
  test("stripInjected keeps only what the person typed", () => {
    expect(stripInjected(`${REMINDER}\nFix the login bug`)).toBe("Fix the login bug");
    expect(stripInjected(`a ${REMINDER} b ${REMINDER}`)).toBe("a  b");
    expect(stripInjected("<system-reminder>never closed")).toBe("");
    expect(stripInjected("plain")).toBe("plain");
  });

  test("the preview (and so the session title) skips the reminder", () => {
    const [e] = userMessages([
      user("u1", [
        { type: "text", text: REMINDER },
        { type: "text", text: "Fix the login bug" },
      ]),
    ]);
    expect(e?.data).toMatchObject({ textPreview: "Fix the login bug", origin: "human" });
  });

  test("a turn that is only injected context is meta, not a human prompt", () => {
    const [e] = userMessages([user("u2", REMINDER)]);
    expect(e?.data.origin).toBe("meta");
  });

  test("the conversation shows the typed text and drops reminder-only turns", () => {
    const messages = conversationOf([user("u3", REMINDER), user("u4", `${REMINDER}\nHello`)]);
    expect(messages).toEqual([
      { uuid: "u4", role: "user", ts: "2026-10-12T00:00:00.000Z", text: "Hello" },
    ]);
  });
});
