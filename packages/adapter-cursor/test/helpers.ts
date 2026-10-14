import type { GravitaEvent } from "@gravita/protocol";
import {
  type AcpProtocol,
  CursorAcpClient,
  CursorAcpMapper,
  type CursorAcpMapperOptions,
  cursorSessionId,
  type ServerRequest,
} from "../src";
import { cursorAcpScript, ScriptedAcpServer } from "../src/testing/scripted-acp-server";

export const CWD = "/work/demo";
export const acpSid = (n: number) => `5e55c0de-0000-4000-8000-00000000000${n}`;

export const tick = () => new Promise((r) => setTimeout(r, 0));

/** Answers a permission request with the first option of the kind `choose` names. */
export function answerWith(kind: "allow_once" | "reject_once") {
  return (r: ServerRequest) => {
    const params = r.params as AcpProtocol.RequestPermissionParams;
    const option = params.options.find((o) => o.kind === kind);
    return Promise.resolve<AcpProtocol.RequestPermissionResponse>(
      option
        ? { outcome: { outcome: "selected", optionId: option.optionId } }
        : { outcome: { outcome: "cancelled" } },
    );
  };
}

/** A fixture's server, a client on it, and a mapper fed by the client's updates. */
export function connect(
  scenario: string,
  n: number,
  o: {
    onRequest?: (r: ServerRequest) => Promise<unknown>;
    mapper?: Partial<CursorAcpMapperOptions>;
  } = {},
) {
  const server = new ScriptedAcpServer(cursorAcpScript(scenario));
  const events: GravitaEvent[] = [];
  const updates: AcpProtocol.SessionNotification[] = [];
  let at = 0;
  const mapper = new CursorAcpMapper({
    projectId: "p1",
    sessionId: cursorSessionId(acpSid(n)),
    acpSessionId: acpSid(n),
    model: "default[]",
    mode: "agent",
    now: () => new Date(Date.UTC(2026, 9, 14, 12, 0, at++)).toISOString(),
    ...o.mapper,
  });
  const client = new CursorAcpClient(server.transport, {
    onNotification: (msg) => {
      if (msg.method !== "session/update") return;
      updates.push(msg.params);
      events.push(...mapper.map(msg.params));
    },
    ...(o.onRequest ? { onRequest: o.onRequest } : {}),
  });
  return { server, client, mapper, events, updates };
}

/** The handshake, then one prompt from start to stop reason. */
export async function playTurn(
  c: ReturnType<typeof connect>,
  text: string,
  turnId = "u1",
  during?: () => void | Promise<void>,
) {
  await c.client.initialize({ name: "gravita", version: "test" });
  const session = await c.client.call("session/new", { cwd: CWD, mcpServers: [] });
  c.events.push(...c.mapper.beginTurn(turnId));
  const prompt = c.client.call("session/prompt", {
    sessionId: session.sessionId,
    prompt: [{ type: "text", text }],
  });
  await during?.();
  const { stopReason } = await prompt;
  c.events.push(...c.mapper.endTurn({ stopReason }));
  return { session, stopReason };
}
