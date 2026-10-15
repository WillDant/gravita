import type { RolloutFs } from "@gravita/adapter-codex";
import {
  normalizedPrompt,
  parseTranscriptLine,
  type TranscriptRecord,
  userQueryOf,
} from "./records";
import { transcriptTool } from "./tools";

/** How much of a file one read takes. */
const CHUNK_BYTES = 4 * 1024 * 1024;

function lineEnd(bytes: Uint8Array): number {
  const i = bytes.lastIndexOf(0x0a);
  return i < 0 ? 0 : i + 1;
}

/**
 * The complete records written to a transcript since `p.offset` (a file only ever grows);
 * `p.offset` moves past them. A last line without its newline counts once it parses.
 */
export async function readNewRecords(
  fs: RolloutFs,
  path: string,
  p: { offset: number },
  size: number,
  onSkip?: (path: string, reason: string) => void,
): Promise<TranscriptRecord[]> {
  const records: TranscriptRecord[] = [];
  while (p.offset < size) {
    let bytes: Uint8Array;
    try {
      bytes = await fs.readRange(path, p.offset, Math.min(CHUNK_BYTES, size - p.offset));
    } catch (err) {
      onSkip?.(path, err instanceof Error ? err.message : String(err));
      return records;
    }
    if (bytes.length === 0) break;
    let end = lineEnd(bytes);
    if (end === 0 || end < bytes.length) {
      const rest = new TextDecoder().decode(bytes.subarray(end));
      if (p.offset + bytes.length >= size && parseTranscriptLine(rest)) end = bytes.length;
    }
    if (end === 0) break;
    for (const line of new TextDecoder().decode(bytes.subarray(0, end)).split("\n")) {
      const r = parseTranscriptLine(line);
      if (r) records.push(r);
    }
    p.offset += end;
  }
  return records;
}

/** What a transcript says about how chats relate: enough to tell a subagent from a chat. */
export interface TranscriptDigest {
  ino: number;
  offset: number;
  /** The first message in it, spaces collapsed. */
  firstPrompt?: string;
  /** The prompts of the subagent tasks it started. */
  taskPrompts: string[];
}

/** Brings a digest up to date with the file (reading only what was appended). */
export async function updateDigest(
  fs: RolloutFs,
  path: string,
  digest: TranscriptDigest | undefined,
  onSkip?: (path: string, reason: string) => void,
): Promise<TranscriptDigest | undefined> {
  let st: Awaited<ReturnType<RolloutFs["stat"]>>;
  try {
    st = await fs.stat(path);
  } catch {
    return undefined;
  }
  let d = digest;
  if (!d || d.ino !== st.ino || st.size < d.offset) d = { ino: st.ino, offset: 0, taskPrompts: [] };
  for (const r of await readNewRecords(fs, path, d, st.size, onSkip)) {
    if (r.kind === "user") d.firstPrompt ??= normalizedPrompt(userQueryOf(r.text));
    if (r.kind !== "assistant") continue;
    for (const b of r.blocks) {
      if (b.type !== "tool") continue;
      const task = transcriptTool(b.name, b.input)?.task;
      if (task) d.taskPrompts.push(normalizedPrompt(task.prompt));
    }
  }
  return d;
}
