import type { SessionState } from "@gravita/core";
import type { ConversationMessage, GravitaEvent } from "@gravita/protocol";
import { MAIN_AGENT } from "@gravita/protocol/ids";
import { memo, useLayoutEffect, useMemo, useRef } from "react";
import { clock, t, useLocale } from "@/shared/i18n/i18n";
import { agentTypeLabel } from "@/shared/presenters/agent";
import { Button, LineBadge } from "@/shared/ui/ui";
import { cn } from "@/shared/utils";
import { useAppStore, useConversation, useSessionEvents } from "@/state/hooks";
import { MessageText } from "./MessageText";

/** Spawn tool-use id → the subagent it started, from the session's `agent.spawned` events. */
export function spawnedAgents(events: readonly GravitaEvent[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const e of events) {
    if (e.type === "agent.spawned" && e.data.spawnToolUseId && e.agentId) {
      map.set(e.data.spawnToolUseId, e.agentId);
    }
  }
  return map;
}

/** The Conversation lens: what the user and the main agent said, in full. */
export default function ConversationLens({
  session,
  onSelect,
  speaker,
  empty,
}: {
  session: SessionState;
  onSelect: (agentId: string) => void;
  /** Who answers the user, when it isn't the session's main agent (a squad's planner). */
  speaker?: { name: string; agentType: string };
  /** What an empty conversation says instead of the default. */
  empty?: string;
}) {
  useLocale();
  const view = useConversation(session.id);
  const retry = useAppStore((s) => s.refreshConversation);
  const events = useSessionEvents(session.id);
  const spawned = useMemo(() => spawnedAgents(events), [events]);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const count = view?.messages.length ?? 0;

  // Follow new messages like a chat, unless the user scrolled up to read.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when messages arrive.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [count]);

  if (!view || (view.status === "loading" && count === 0)) {
    return (
      <div aria-busy="true" className="mx-auto flex max-w-[760px] flex-col gap-5 px-6 py-8">
        <span className="sr-only">{t("conversation.loading")}</span>
        {[72, 96, 56].map((w) => (
          <div key={w} className="flex flex-col gap-2" aria-hidden="true">
            <div className="h-3 w-24 rounded bg-panel" />
            <div className="h-3 rounded bg-panel" style={{ width: `${w}%` }} />
            <div className="h-3 w-1/2 rounded bg-panel" />
          </div>
        ))}
      </div>
    );
  }

  if (view.status === "failed") {
    return (
      <div className="flex flex-col items-start gap-3 px-8 py-8">
        <p className="text-sm text-ink-2">{t("conversation.failed")}</p>
        <Button onClick={retry}>{t("conversation.retry")}</Button>
      </div>
    );
  }

  if (count === 0) {
    return (
      <p className="px-8 py-8 text-sm text-ink-2">
        {empty ??
          (session.controllable ? t("conversation.emptyControllable") : t("conversation.empty"))}
      </p>
    );
  }

  return (
    <div
      ref={scroller}
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
      className="h-full overflow-y-auto"
    >
      <ol className="mx-auto flex max-w-[760px] flex-col gap-6 px-6 py-6">
        {view.messages.map((m) => (
          <Message
            key={m.uuid}
            message={m}
            spawned={spawned}
            onSelect={onSelect}
            {...(speaker ? { speaker } : {})}
          />
        ))}
      </ol>
    </div>
  );
}

const Message = memo(function Message({
  message,
  spawned,
  onSelect,
  speaker,
}: {
  message: ConversationMessage;
  spawned: Map<string, string>;
  onSelect: (agentId: string) => void;
  speaker?: { name: string; agentType: string };
}) {
  const user = message.role === "user";
  return (
    <li className={cn("flex flex-col gap-1.5", user && "rounded-xl bg-panel px-4 py-3")}>
      <div className="flex items-center gap-2 text-xs">
        {!user && <LineBadge agentType={speaker?.agentType ?? MAIN_AGENT} size={16} />}
        <span className="font-semibold text-ink">
          {user ? t("conversation.you") : (speaker?.name ?? t("agent.main"))}
        </span>
        <time dateTime={message.ts} className="text-ink-3 tabular-nums">
          {clock(message.ts)}
        </time>
      </div>
      <div className={cn(!user && "pl-6")}>
        <MessageText text={message.text} />
        {message.spawned && message.spawned.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {message.spawned.map((s) => (
              <li key={s.toolUseId}>
                <SpawnChip
                  agentType={s.agentType}
                  agentId={spawned.get(s.toolUseId)}
                  onSelect={onSelect}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
});

function SpawnChip({
  agentType,
  agentId,
  onSelect,
}: {
  agentType: string;
  agentId?: string;
  onSelect: (agentId: string) => void;
}) {
  const body = (
    <>
      <LineBadge agentType={agentType} size={16} />
      <span className="truncate">{agentTypeLabel(agentType)}</span>
    </>
  );
  const chip =
    "inline-flex h-6 max-w-[240px] items-center gap-1.5 rounded-full bg-panel pr-2.5 pl-1 text-xs font-medium text-ink-2";
  if (!agentId) return <span className={chip}>{body}</span>;
  return (
    <button
      type="button"
      onClick={() => onSelect(agentId)}
      aria-label={t("conversation.openAgent", { agent: agentType })}
      className={cn(chip, "transition-colors hover:bg-panel-2 hover:text-ink")}
    >
      {body}
    </button>
  );
}
