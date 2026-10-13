import { keys, MAIN_AGENT } from "@gravita/protocol";
import { previewText } from "../../domain/chat-policy";
import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/id-generator";
import type { SessionRuntimeRegistry } from "../ports/session-runtime";
import type { IngestEvents } from "./ingest-events";
import { requireRuntime } from "./require-runtime";

/** Sends the user's next message to a session Gravita runs. */
export class SendMessage {
  constructor(
    private readonly runtimes: SessionRuntimeRegistry,
    private readonly ingest: IngestEvents,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(p: { sessionId: string; text: string }): Promise<{ ok: true }> {
    const runtime = requireRuntime(this.runtimes, p.sessionId);
    const uuid = this.ids.uuid();
    this.ingest.execute([
      {
        key: keys.userMessage(uuid),
        ts: this.clock.iso(),
        source: "gravita",
        provider: runtime.provider,
        projectId: runtime.projectId,
        sessionId: p.sessionId,
        agentId: MAIN_AGENT,
        type: "message.user",
        data: { uuid, textPreview: previewText(p.text), origin: "gravita" },
      },
    ]);
    await runtime.send(p.text, uuid);
    return { ok: true };
  }
}
