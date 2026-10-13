import { hookAgentId, mapHook, parseHookPayload } from "@gravita/adapter-claude";
import type { HookTranslator, ParsedHook } from "../../application/ports/hook-translator";
import { CLAUDE } from "./provider";

/** Claude Code hooks (from the Deep Observe plugin), through the adapter's pure mapper. */
export class ClaudeHookTranslator implements HookTranslator {
  readonly provider = CLAUDE;

  parse(raw: unknown): ParsedHook | null {
    const p = parseHookPayload(raw);
    if (!p) return null;
    return {
      sessionId: p.session_id,
      agentId: hookAgentId(p),
      cwd: p.cwd || undefined,
      spooledAt: p.gravita_spooled_at === undefined ? undefined : p.gravita_spooled_at * 1_000,
      map: (ctx) => mapHook(p, ctx),
    };
  }
}
