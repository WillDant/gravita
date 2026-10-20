import { activityOf, type SessionState, type Station, toPersona } from "@gravita/core";
import { agentColor } from "@gravita/orbs";
import type { ConversationMessage, GravitaEvent } from "@gravita/protocol";
import { MAIN_AGENT } from "@gravita/protocol/ids";
import { ArrowDown, ChevronRight } from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import {
  Fragment,
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { clock, t, useLocale } from "@/shared/i18n/i18n";
import { agentTypeLabel } from "@/shared/presenters/agent";
import { CopyButton } from "@/shared/ui/CopyButton";
import { Motion } from "@/shared/ui/motion";
import { ShiningText } from "@/shared/ui/ShiningText";
import { Button, LineBadge } from "@/shared/ui/ui";
import { cn } from "@/shared/utils";
import { useAppStore, useConversation, useNow, useSessionEvents } from "@/state/hooks";
import { hasArrived } from "@/state/slices/conversation";
import { Story } from "../agent-panel/Timeline";
import { MessageText } from "./MessageText";
import { BEFORE_FIRST, summarizeSteps, toolStepsByMessage } from "./toolSteps";
import { Welcome } from "./Welcome";

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

/** The Conversation lens: what the user and the main agent said, and what it did between. */
export default function ConversationLens(props: {
  session: SessionState;
  onSelect: (agentId: string) => void;
  /** Who answers the user, when it isn't the session's main agent (a squad's planner). */
  speaker?: { name: string; agentType: string };
  /** What an empty conversation says instead of the default. */
  empty?: string;
}) {
  return (
    <Motion>
      <Conversation {...props} />
    </Motion>
  );
}

function Conversation({
  session,
  onSelect,
  speaker,
  empty,
}: {
  session: SessionState;
  onSelect: (agentId: string) => void;
  speaker?: { name: string; agentType: string };
  empty?: string;
}) {
  useLocale();
  const view = useConversation(session.id);
  const retry = useAppStore((s) => s.refreshConversation);
  const pending = useAppStore((s) =>
    s.pendingMessage?.sessionId === session.id ? s.pendingMessage : undefined,
  );
  const events = useSessionEvents(session.id);
  const now = useNow();
  const spawned = useMemo(() => spawnedAgents(events), [events]);
  const messages = view?.messages ?? NO_MESSAGES;
  const steps = useMemo(() => toolStepsByMessage(events, messages), [events, messages]);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [away, setAway] = useState(false);
  // Messages already there when the conversation first shows don't animate in; new ones do.
  const settled = useRef(false);
  useEffect(() => {
    if (view?.status === "ready") settled.current = true;
  }, [view?.status]);

  const count = messages.length;
  const waitingForEcho = pending && !hasArrived(messages, pending) ? pending : undefined;
  const working = workingLine(session, now, speaker, Boolean(waitingForEcho));
  const stepCount = steps.size;
  // A fresh chat: the agent is up but nothing has been said or done. Its startup reads as
  // "thinking", which isn't worth announcing before the first message.
  const main = session.agents[MAIN_AGENT];
  const activity = main ? activityOf(main, session, now) : undefined;
  const fresh =
    count === 0 &&
    stepCount === 0 &&
    !waitingForEcho &&
    (activity === undefined || activity === "thinking");

  const toBottom = (smooth: boolean) => {
    const el = scroller.current;
    if (!el) return;
    if (smooth && el.scrollTo) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    else el.scrollTop = el.scrollHeight;
  };

  // Follow new content like a chat, unless the user scrolled up to read.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when content arrives.
  useLayoutEffect(() => {
    if (pinned.current) toBottom(false);
  }, [count, waitingForEcho, working, stepCount]);

  if (!view || (view.status === "loading" && count === 0 && !waitingForEcho)) {
    return (
      <div aria-busy="true" className="mx-auto flex max-w-[760px] flex-col gap-5 px-6 py-8">
        <ShiningText text={t("conversation.loading")} className="text-sm" />
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

  if (view.status === "failed" && count === 0) {
    return (
      <div className="flex flex-col items-start gap-3 px-8 py-8">
        <p className="text-sm text-ink-2">{t("conversation.failed")}</p>
        <Button onClick={retry}>{t("conversation.retry")}</Button>
      </div>
    );
  }

  if (fresh && session.controllable && !session.ended && !speaker && !empty) {
    return <Welcome provider={session.provider} />;
  }

  if (count === 0 && !waitingForEcho && !working && stepCount === 0) {
    return (
      <p className="px-8 py-8 text-sm text-ink-2">
        {empty ??
          (session.controllable ? t("conversation.emptyControllable") : t("conversation.empty"))}
      </p>
    );
  }

  const before = steps.get(BEFORE_FIRST);
  return (
    <div className="relative h-full">
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          setAway(!pinned.current);
        }}
        className="h-full overflow-y-auto"
      >
        <ol className="mx-auto flex max-w-[760px] flex-col gap-6 px-6 py-6">
          {before && <ToolSteps stations={before} />}
          {messages.map((m) => {
            const after = steps.get(m.uuid);
            return (
              <Fragment key={m.uuid}>
                <Message
                  message={m}
                  spawned={spawned}
                  onSelect={onSelect}
                  animate={settled.current}
                  {...(speaker ? { speaker } : {})}
                />
                {after && <ToolSteps stations={after} />}
              </Fragment>
            );
          })}
          {waitingForEcho && (
            <Message
              message={{
                uuid: "pending",
                role: "user",
                ts: waitingForEcho.ts,
                text: waitingForEcho.text,
              }}
              spawned={spawned}
              onSelect={onSelect}
              animate
              pending
            />
          )}
          {working && (
            <li className="flex items-center gap-2 pl-6 text-sm" role="status">
              <ShiningText text={working} />
            </li>
          )}
        </ol>
      </div>
      <AnimatePresence>
        {away && (
          <m.button
            type="button"
            key="jump"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            onClick={() => toBottom(true)}
            aria-label={t("conversation.jumpToLatest")}
            title={t("conversation.jumpToLatest")}
            className="absolute bottom-4 left-1/2 inline-flex size-8 -translate-x-1/2 items-center justify-center rounded-full border border-hairline-strong bg-ground text-ink-2 shadow-float transition-colors hover:text-ink"
          >
            <ArrowDown size={15} aria-hidden="true" />
          </m.button>
        )}
      </AnimatePresence>
    </div>
  );
}

const NO_MESSAGES: ConversationMessage[] = [];

/**
 * "Main agent is editing auth.ts", while the agent who answers works, or "is thinking" from
 * the moment a message is sent until the agent picks it up.
 */
export function workingLine(
  session: SessionState,
  now: number,
  speaker: { name: string } | undefined,
  justSent: boolean,
): string | undefined {
  const main = session.agents[MAIN_AGENT];
  const name = speaker?.name ?? t("agent.main");
  if (main && activityOf(main, session, now)) {
    const { key, params } = toPersona(main, session, now).label;
    return `${name} ${t(key, params)}`;
  }
  return justSent ? `${name} ${t("persona.thinking")}` : undefined;
}

/** The main agent's tool calls between two messages: one line, opened into the story. */
function ToolSteps({ stations }: { stations: Station[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const parts = summarizeSteps(stations);
  const failed = stations.filter((s) => s.status === "error").length;
  const shown = parts.slice(0, 3).map((p) =>
    t(`story.${p.kind}`, {
      count: p.count,
      target: p.kind === "agent" ? agentTypeLabel(p.target) : p.target,
    }),
  );
  const more = parts.length - shown.length;
  return (
    <li className="pl-6">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${shown.join(" · ")}. ${t(open ? "conversation.steps.hide" : "conversation.steps.show")}`}
        onClick={() => setOpen((o) => !o)}
        className="group -ml-1.5 flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm text-ink-2 transition-colors hover:bg-panel hover:text-ink"
      >
        <ChevronRight
          size={14}
          aria-hidden="true"
          className={cn("flex-none text-ink-3 transition-transform", open && "rotate-90")}
        />
        <span className="truncate">
          {shown.join(" · ")}
          {more > 0 && ` · +${more}`}
        </span>
        {failed > 0 && <span className="flex-none text-error-ink">· {t("story.failed")}</span>}
      </button>
      {open && (
        <m.div
          id={id}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="pt-2 pb-1"
        >
          <Story stations={stations} color={agentColor(MAIN_AGENT).line} />
        </m.div>
      )}
    </li>
  );
}

const Message = memo(function Message({
  message,
  spawned,
  onSelect,
  speaker,
  animate,
  pending,
}: {
  message: ConversationMessage;
  spawned: Map<string, string>;
  onSelect: (agentId: string) => void;
  speaker?: { name: string; agentType: string };
  /** Slides in (a message that arrived while the conversation was open). */
  animate: boolean;
  /** Sent, not yet in the transcript. */
  pending?: boolean;
}) {
  const user = message.role === "user";
  return (
    <m.li
      initial={animate ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      aria-busy={pending || undefined}
      className={cn(
        "group/message relative flex flex-col gap-1.5",
        user && "rounded-xl bg-panel px-4 py-3",
      )}
    >
      <div className="flex items-center gap-2 text-xs">
        {!user && <LineBadge agentType={speaker?.agentType ?? MAIN_AGENT} size={16} />}
        <span className="font-semibold text-ink">
          {user ? t("conversation.you") : (speaker?.name ?? t("agent.main"))}
        </span>
        {pending ? (
          <span className="text-ink-3">{t("composer.sending")}</span>
        ) : (
          <time dateTime={message.ts} className="text-ink-3 tabular-nums">
            {clock(message.ts)}
          </time>
        )}
        {!pending && (
          <CopyButton
            text={message.text}
            label={t("conversation.copy")}
            className="-my-1 ml-auto opacity-0 group-hover/message:opacity-100 focus-visible:opacity-100"
          />
        )}
      </div>
      <div className={cn(!user && "pl-6", pending && "text-ink-2")}>
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
    </m.li>
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
