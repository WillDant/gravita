import {
  applyBootstrapLine,
  type MemoryCredentialSource,
} from "../infrastructure/credentials/memory-credential-source";

/**
 * The engine's stdin when the desktop shell starts it (`--token-stdin`): the session token
 * on the first line, then one JSON line per change of the Cursor API key (see
 * `applyBootstrapLine`); other lines are heartbeats. EOF means the parent is gone. Resolves
 * with the token; keeps reading until EOF, then calls `onEof`. Nothing read is logged.
 */
export async function readStdinBootstrap(
  stream: ReadableStream<Uint8Array>,
  credentials: MemoryCredentialSource,
  onEof: () => void,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) throw new Error("stdin closed before a token was sent");
    buf += decoder.decode(value, { stream: true });
    const nl = buf.indexOf("\n");
    if (nl < 0) continue;
    const token = buf.slice(0, nl).trim();
    let rest = buf.slice(nl + 1);
    const takeLines = () => {
      let at = rest.indexOf("\n");
      while (at >= 0) {
        applyBootstrapLine(rest.slice(0, at), credentials);
        rest = rest.slice(at + 1);
        at = rest.indexOf("\n");
      }
    };
    // The key may come in the same chunk as the token: it applies before the engine starts.
    takeLines();
    void (async () => {
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          rest += decoder.decode(next.value, { stream: true });
          takeLines();
        }
      } finally {
        onEof();
      }
    })();
    return token;
  }
}
