import { decompressRollout, isCompressed, nodeRolloutFs, type RolloutFs } from "./fs";
import { parseRolloutLine, type SessionMeta, sessionMetaOf } from "./records";

const HEAD_CHUNK = 64 * 1024;

/**
 * Reads a rollout's first line, its `session_meta` (which carries Codex's base instructions,
 * so it can be tens of kilobytes). Null when the file is missing, still empty, or doesn't
 * start with a session meta.
 */
export async function readRolloutHead(
  path: string,
  fs: RolloutFs = nodeRolloutFs,
  maxBytes = 4 << 20,
): Promise<SessionMeta | null> {
  if (isCompressed(path)) {
    const bytes = await fs.readFile(path).catch(() => null);
    const data = bytes ? decompressRollout(bytes) : null;
    if (!data) return null;
    const nl = Buffer.from(data).indexOf(0x0a);
    return headOf(Buffer.from(data.subarray(0, nl < 0 ? data.length : nl)));
  }
  const chunks: Buffer[] = [];
  let pos = 0;
  while (pos < maxBytes) {
    let chunk: Uint8Array;
    try {
      chunk = await fs.readRange(path, pos, HEAD_CHUNK);
    } catch {
      return null;
    }
    if (chunk.byteLength <= 0) break;
    const buf = Buffer.from(chunk);
    const nl = buf.indexOf(0x0a);
    if (nl >= 0) {
      chunks.push(buf.subarray(0, nl));
      return headOf(Buffer.concat(chunks));
    }
    chunks.push(buf);
    pos += chunk.byteLength;
  }
  // No newline yet: complete only if it already parses (a strict prefix of JSON never does).
  return headOf(Buffer.concat(chunks));
}

function headOf(line: Buffer): SessionMeta | null {
  const r = parseRolloutLine(line.toString("utf8"));
  return r ? sessionMetaOf(r) : null;
}
