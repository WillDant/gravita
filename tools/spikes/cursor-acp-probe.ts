#!/usr/bin/env bun
// Disposable spike (spec/cursor-provider T01): drives `cursor-agent acp` with the environment
// gravita builds for it and prints every JSON-RPC line in and out. Never commit its output
// as-is: fixtures under fixtures/cursor-acp/ are synthetic.
//
//   bun tools/spikes/cursor-acp-probe.ts [--prompt "text"] [--cwd dir] [--models]
//
// The key comes from GRAVITA_PROBE_CURSOR_KEY (never CURSOR_API_KEY: the probe strips every
// CURSOR_* / AGENT_CLI_* variable, exactly like the engine does). Without it the probe
// shows what the CLI does with no credential.

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const prompt = flag("--prompt");
const cwd = flag("--cwd") ?? process.cwd();
const listModels = args.includes("--models");
// biome-ignore lint/suspicious/noUndeclaredEnvVars: a manual probe, never a turbo task.
const key = process.env.GRAVITA_PROBE_CURSOR_KEY;

const env: Record<string, string> = {};
for (const [name, value] of Object.entries(process.env)) {
  if (value === undefined) continue;
  if (name.startsWith("CURSOR_") || name.startsWith("AGENT_CLI_")) continue;
  if (name === "GRAVITA_PROBE_CURSOR_KEY") continue;
  env[name] = value;
}
env.AGENT_CLI_CREDENTIAL_STORE = "memory";
env.NO_OPEN_BROWSER = "1";
if (key) env.CURSOR_API_KEY = key;

const mask = (text: string): string => (key ? text.split(key).join("••••") : text);

if (listModels) {
  const proc = Bun.spawn(["cursor-agent", "models"], { cwd, env, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  console.log(`exit ${code}\n--- stdout\n${mask(out)}\n--- stderr\n${mask(err)}`);
  process.exit(0);
}

const proc = Bun.spawn(["cursor-agent", "acp"], {
  cwd,
  env,
  stdin: "pipe",
  stdout: "pipe",
  stderr: "pipe",
});
const deadline = Number(flag("--timeout") ?? 45) * 1000;
setTimeout(() => {
  console.log(`-- timed out after ${deadline} ms`);
  proc.kill();
  process.exit(2);
}, deadline).unref();

let nextId = 1;
const pending = new Map<number, (msg: Record<string, unknown>) => void>();

function send(msg: Record<string, unknown>): void {
  const line = JSON.stringify({ jsonrpc: "2.0", ...msg });
  console.log(`>> ${mask(line)}`);
  proc.stdin.write(`${line}\n`);
}

function call(method: string, params: unknown): Promise<Record<string, unknown>> {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    send({ id, method, params });
  });
}

async function pump(stream: ReadableStream<Uint8Array>, tag: string): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl = buffer.indexOf("\n");
    while (nl >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf("\n");
      if (!line.trim()) continue;
      console.log(`${tag} ${mask(line)}`);
      if (tag !== "<<") continue;
      const msg = JSON.parse(line) as Record<string, unknown>;
      if (typeof msg.id === "number" && !("method" in msg)) {
        pending.get(msg.id)?.(msg);
        pending.delete(msg.id);
      } else if (msg.method === "session/request_permission") {
        // Spike: always reject so nothing runs unattended.
        send({ id: msg.id, result: { outcome: { outcome: "selected", optionId: "reject-once" } } });
      } else if (typeof msg.id !== "undefined" && "method" in msg) {
        send({ id: msg.id, error: { code: -32601, message: "not supported by the probe" } });
      }
    }
  }
}

void pump(proc.stdout, "<<");
void pump(proc.stderr, "!!");

const init = await call("initialize", {
  protocolVersion: 1,
  clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
  clientInfo: { name: "gravita-probe", version: "0.0.0" },
});
if (!init.error) {
  const session = await call("session/new", { cwd, mcpServers: [] });
  const sessionId = (session.result as { sessionId?: string } | undefined)?.sessionId;
  if (sessionId && prompt) {
    await call("session/prompt", { sessionId, prompt: [{ type: "text", text: prompt }] });
  }
}
proc.kill();
await proc.exited;
