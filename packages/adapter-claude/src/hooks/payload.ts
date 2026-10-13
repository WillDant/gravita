import { z } from "zod";

// The JSON a Claude Code command hook receives on stdin, as the Deep Observe plugin forwards
// it. Only the fields Gravita reads are declared; every other field (the prompt text of
// UserPromptSubmit, transcript_path, …) is accepted and dropped while parsing. A field of an
// unexpected type is treated as absent rather than failing the whole payload.

const opt = <T extends z.ZodType>(t: T) => t.optional().catch(undefined);

/** Hook events Gravita reads; anything else is ignored before it is mapped. */
export const HOOK_EVENTS = [
  "SessionStart",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionRequest",
  "Notification",
  "SubagentStop",
  "Stop",
  "UserPromptSubmit",
  "SessionEnd",
] as const;

export type HookEventName = (typeof HOOK_EVENTS)[number];

export const HookPayload = z.object({
  session_id: z.string().min(1),
  hook_event_name: z.enum(HOOK_EVENTS),
  cwd: opt(z.string()),
  /** Present when the hook fires inside a subagent. */
  agent_id: opt(z.string().min(1)),
  /** SessionStart: startup | resume | clear | compact. */
  source: opt(z.string()),
  tool_name: opt(z.string().min(1)),
  tool_input: opt(z.record(z.string(), z.unknown())),
  tool_use_id: opt(z.string().min(1)),
  tool_response: opt(z.unknown()),
  /** PostToolUseFailure. */
  error: opt(z.unknown()),
  notification_type: opt(z.string()),
  /** Added by the plugin when it had to spool the hook (epoch seconds). */
  gravita_spooled_at: opt(z.number().nonnegative()),
});

export type HookPayload = z.infer<typeof HookPayload>;

/** A hook payload Gravita reads, or null (malformed, or an event it doesn't use). */
export function parseHookPayload(raw: unknown): HookPayload | null {
  const parsed = HookPayload.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
