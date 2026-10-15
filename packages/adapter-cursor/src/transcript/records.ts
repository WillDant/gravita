// What `cursor-agent` writes as it works: one JSON object per line in
// <cursorHome>/projects/<folder>/agent-transcripts/<chat>/<chat>.jsonl. A line is a message
// of the user or the assistant (text and tool calls, no results), or the mark that ends a
// turn. Parsing is an allowlist: unknown fields are ignored and nothing throws.

export type TranscriptBlock =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; input: Record<string, unknown> };

export type TranscriptRecord =
  | { kind: "user"; text: string }
  | { kind: "assistant"; blocks: TranscriptBlock[] }
  | { kind: "turn_ended"; status: string };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function blocksOf(content: unknown): TranscriptBlock[] {
  if (!Array.isArray(content)) return [];
  const blocks: TranscriptBlock[] = [];
  for (const b of content) {
    if (!isObject(b)) continue;
    if (b.type === "text" && typeof b.text === "string") {
      blocks.push({ type: "text", text: b.text });
    } else if (b.type === "tool_use" && typeof b.name === "string") {
      blocks.push({ type: "tool", name: b.name, input: isObject(b.input) ? b.input : {} });
    }
  }
  return blocks;
}

/** A line of a transcript as a record; undefined for anything else (or a broken line). */
export function parseTranscriptLine(line: string): TranscriptRecord | undefined {
  const text = line.trim();
  if (!text) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isObject(raw)) return undefined;
  if (raw.type === "turn_ended") {
    return { kind: "turn_ended", status: typeof raw.status === "string" ? raw.status : "success" };
  }
  const message = isObject(raw.message) ? raw.message : undefined;
  if (!message) return undefined;
  const blocks = blocksOf(message.content);
  if (raw.role === "user") {
    const texts = blocks.flatMap((b) => (b.type === "text" ? [b.text] : []));
    return { kind: "user", text: texts.join("\n") };
  }
  if (raw.role === "assistant") return { kind: "assistant", blocks };
  return undefined;
}

const QUERY = /<user_query>\s*([\s\S]*?)\s*<\/user_query>/;

/** What the user typed: the transcript wraps it in a timestamp and a `user_query` tag. */
export function userQueryOf(text: string): string {
  const m = QUERY.exec(text);
  if (m) return m[1] ?? "";
  return text.replace(/<timestamp>[\s\S]*?<\/timestamp>/g, "").trim();
}

/** Cursor masks the model's reasoning as `[REDACTED]`; what is left is the visible text. */
export function visibleText(text: string): string {
  return text.replace(/\[REDACTED\]/g, "").trim();
}

/** The same text compared across transcripts (a subagent's first message is its task prompt). */
export function normalizedPrompt(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
