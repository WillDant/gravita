import { StringDecoder } from "node:string_decoder";
import { nodeTranscriptFs, type TranscriptFs } from "./fs";
import { parseLine } from "./records";

export interface SessionHead {
  cwd: string;
  /** Timestamp of the first timestamped record. */
  ts: string;
}

const HEAD_CHUNK = 64 * 1024;

/** Reads the start of a transcript until a record carries `cwd`. `null` if none yet. */
export async function readSessionHead(
  path: string,
  maxBytes = 1 << 20,
  fs: TranscriptFs = nodeTranscriptFs,
): Promise<SessionHead | null> {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  let ts: string | undefined;
  let pos = 0;
  while (pos < maxBytes) {
    let chunk: Uint8Array;
    try {
      chunk = await fs.readRange(path, pos, HEAD_CHUNK);
    } catch (err) {
      // A missing or unreadable file has no head yet.
      if (pos === 0) return null;
      throw err;
    }
    if (chunk.byteLength <= 0) break;
    pos += chunk.byteLength;
    const lines = (pending + decoder.write(chunk)).split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      const r = parseLine(line);
      if (!r) continue;
      ts ??= r.timestamp;
      if (r.cwd) return { cwd: r.cwd, ts: r.timestamp ?? ts ?? "" };
    }
  }
  const last = parseLine(pending);
  if (last?.cwd) return { cwd: last.cwd, ts: last.timestamp ?? ts ?? "" };
  return null;
}
