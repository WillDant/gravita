import type { SessionState } from "@gravita/core";
import type { ContextUsage } from "@gravita/protocol";
import { ChevronRight, Gauge, RefreshCw, X } from "lucide-react";
import { type ReactNode, useEffect, useId, useMemo, useState } from "react";
import { compact, t, useLocale } from "@/shared/i18n/i18n";
import { type ContextLevel, contextLevel, contextView } from "@/shared/presenters/context";
import { cn } from "@/shared/utils";
import { useSessionContext } from "./useSessionContext";

// What fills the session's context window: a meter in the session header (from the latest
// reply, any provider) that opens a side panel with Claude Code's /context breakdown — by
// category, MCP tools, memory files, agents and skills — for the chats Gravita runs.

/** One colour per category in use, by order (tokens in styles.css, one value per theme). */
const SWATCHES = 7;
const swatch = (i: number) => `var(--ctx-${(i % SWATCHES) + 1})`;

const LEVEL_STROKE: Record<ContextLevel, string> = {
  ok: "var(--ink-2)",
  warn: "var(--waiting)",
  full: "var(--error)",
};
const LEVEL_TEXT: Record<ContextLevel, string> = {
  ok: "text-ink-2",
  warn: "text-waiting-ink",
  full: "text-error-ink",
};

/** The header meter: a ring and the share of the window in use. Hidden before the first reply. */
export function ContextButton({ session }: { session: SessionState }) {
  useLocale();
  const [open, setOpen] = useState(false);
  const view = contextView(session);
  if (!view) return null;
  const level = contextLevel(view.percent);
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t("context.open", { percent: view.percent })}
        title={t("context.meter", {
          tokens: compact(view.tokens),
          window: compact(view.window),
        })}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium tabular-nums transition-colors hover:bg-panel hover:text-ink",
          LEVEL_TEXT[level],
          open && "bg-panel",
        )}
      >
        <Ring percent={view.percent} stroke={LEVEL_STROKE[level]} />
        {view.percent}%
      </button>
      {open && <ContextPanel session={session} onClose={() => setOpen(false)} />}
    </>
  );
}

function Ring({ percent, stroke }: { percent: number; stroke: string }) {
  const r = 6;
  const c = 2 * Math.PI * r;
  const filled = (Math.min(100, Math.max(0, percent)) / 100) * c;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="flex-none">
      <circle cx="8" cy="8" r={r} fill="none" stroke="var(--hairline-strong)" strokeWidth="2" />
      <circle
        cx="8"
        cy="8"
        r={r}
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${c}`}
        transform="rotate(-90 8 8)"
      />
    </svg>
  );
}

export function ContextPanel({ session, onClose }: { session: SessionState; onClose: () => void }) {
  useLocale();
  const titleId = useId();
  // Read again once a turn ends (not on every reply while the agent works).
  const turn = session.presence === "busy" ? "busy" : session.context?.ts;
  const { result, loading, error, refresh } = useSessionContext(session.id, {
    enabled: true,
    turn,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const usage = result?.kind === "full" ? result.usage : undefined;
  const view = contextView(session);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      {/* Pressing outside closes; the keyboard has Escape, so it skips the tab order. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onMouseDown={onClose}
        className="absolute inset-0 cursor-default bg-scrim"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex h-full w-[min(560px,94vw)] flex-col border-l border-hairline bg-ground shadow-float"
      >
        <header className="flex flex-none items-center gap-2 border-b border-hairline px-5 py-3">
          <Gauge size={16} aria-hidden="true" className="text-ink-2" />
          <h2 id={titleId} className="text-sm font-semibold text-ink">
            {t("context.title")}
          </h2>
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-3">
            {usage?.model ?? session.context?.model ?? ""}
          </span>
          <button
            type="button"
            aria-label={t("context.refresh")}
            title={t("context.refresh")}
            aria-busy={loading}
            onClick={refresh}
            className="inline-flex size-7 items-center justify-center rounded-md text-ink-2 hover:bg-panel hover:text-ink"
          >
            <RefreshCw
              size={14}
              aria-hidden="true"
              className={cn(loading && "motion-safe:animate-spin")}
            />
          </button>
          <button
            type="button"
            aria-label={t("context.close")}
            title={t("context.close")}
            onClick={onClose}
            className="inline-flex size-7 items-center justify-center rounded-md text-ink-2 hover:bg-panel hover:text-ink"
          >
            <X size={15} aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {error && (
            <p role="alert" className="px-5 pt-4 text-sm text-error-ink">
              {error}
            </p>
          )}
          {usage ? (
            <FullView usage={usage} cwd={session.cwd} />
          ) : (
            view && (
              <section className="flex flex-col gap-3 px-5 py-4">
                <Total tokens={view.tokens} window={view.window} percent={view.percent} />
                <Bar
                  window={view.window}
                  segments={[
                    { tokens: view.tokens, color: "var(--ink-2)", name: t("context.used") },
                  ]}
                />
                {result?.kind === "unavailable" && (
                  <p className="text-sm text-ink-2">{t("context.unavailable")}</p>
                )}
                {!result && !error && (
                  <p role="status" className="text-sm text-ink-3">
                    {t("context.loading")}
                  </p>
                )}
              </section>
            )
          )}
        </div>
      </aside>
    </div>
  );
}

function Total({ tokens, window, percent }: { tokens: number; window: number; percent: number }) {
  return (
    <p className="flex items-baseline gap-2">
      <span className="text-xl font-semibold tabular-nums text-ink">{compact(tokens)}</span>
      <span className="text-sm text-ink-2 tabular-nums">
        {t("context.ofWindow", { window: compact(window) })}
      </span>
      <span
        className={cn(
          "ml-auto text-sm font-semibold tabular-nums",
          LEVEL_TEXT[contextLevel(percent)],
        )}
      >
        {percent}%
      </span>
    </p>
  );
}

interface Segment {
  name: string;
  tokens: number;
  color: string;
  striped?: boolean;
}

/** The window as one bar: each category's share in its colour, the autocompact reserve striped. */
function Bar({ window, segments }: { window: number; segments: readonly Segment[] }) {
  return (
    <div
      role="img"
      aria-label={segments.map((s) => `${s.name} ${compact(s.tokens)}`).join(", ")}
      className="flex h-3 w-full overflow-hidden rounded-full bg-panel-2"
    >
      {segments.map((s) => (
        <span
          key={s.name}
          title={`${s.name}: ${compact(s.tokens)}`}
          className="h-full"
          style={{
            width: `${Math.min(100, (s.tokens / window) * 100)}%`,
            background: s.striped
              ? `repeating-linear-gradient(135deg, ${s.color} 0 3px, transparent 3px 6px)`
              : s.color,
          }}
        />
      ))}
    </div>
  );
}

function FullView({ usage, cwd }: { usage: ContextUsage; cwd: string }) {
  const used = usage.categories.filter((c) => c.kind === "used" && c.tokens > 0);
  const buffer = usage.categories.filter((c) => c.kind === "buffer" && c.tokens > 0);
  const free = usage.categories.find((c) => c.kind === "free");
  const deferred = usage.categories.filter((c) => c.kind === "deferred" && c.tokens > 0);
  const segments: Segment[] = [
    ...used.map((c, i) => ({ name: c.name, tokens: c.tokens, color: swatch(i) })),
    ...buffer.map((c) => ({
      name: c.name,
      tokens: c.tokens,
      color: "var(--hairline-strong)",
      striped: true,
    })),
  ];
  const share = (n: number) => `${((n / usage.maxTokens) * 100).toFixed(1)}%`;
  return (
    <>
      <section className="flex flex-col gap-3 border-b border-hairline px-5 py-4">
        <Total tokens={usage.totalTokens} window={usage.maxTokens} percent={usage.percentage} />
        <Bar window={usage.maxTokens} segments={segments} />
        {usage.autoCompactThreshold !== undefined && (
          <p className="text-xs text-ink-3">
            {t("context.autoCompact", { tokens: compact(usage.autoCompactThreshold) })}
          </p>
        )}
      </section>

      <Section title={t("context.categories")}>
        <ul className="flex flex-col">
          {segments.map((s) => (
            <Row
              key={s.name}
              label={s.name}
              tokens={s.tokens}
              share={share(s.tokens)}
              dot={s.striped ? undefined : s.color}
            />
          ))}
          {free && <Row label={free.name} tokens={free.tokens} share={share(free.tokens)} muted />}
        </ul>
        {deferred.length > 0 && (
          <>
            <p className="mt-3 mb-1 text-xs text-ink-3">{t("context.deferred")}</p>
            <ul className="flex flex-col">
              {deferred.map((c) => (
                <Row key={c.name} label={c.name} tokens={c.tokens} muted />
              ))}
            </ul>
          </>
        )}
      </Section>

      {usage.mcpTools.length > 0 && (
        <Section title={t("context.mcp", { count: usage.mcpTools.length })}>
          <McpTools tools={usage.mcpTools} />
        </Section>
      )}

      {usage.memoryFiles.length > 0 && (
        <Section title={t("context.memory", { count: usage.memoryFiles.length })}>
          <ul className="flex flex-col">
            {usage.memoryFiles.map((f) => (
              <Row
                key={f.path}
                label={<span className="font-mono text-xs">{shortPath(f.path, cwd)}</span>}
                hint={f.type}
                tokens={f.tokens}
                title={f.path}
              />
            ))}
          </ul>
        </Section>
      )}

      {usage.agents.length > 0 && (
        <Section title={t("context.agents", { count: usage.agents.length })}>
          <ul className="flex flex-col">
            {usage.agents.map((a) => (
              <Row
                key={`${a.source}:${a.agentType}`}
                label={a.agentType}
                hint={a.source}
                tokens={a.tokens}
              />
            ))}
          </ul>
        </Section>
      )}

      {usage.skills && usage.skills.items.length > 0 && (
        <Section
          title={t("context.skills", {
            included: usage.skills.included,
            total: usage.skills.total,
          })}
        >
          <ul className="flex flex-col">
            {usage.skills.items.map((s) => (
              <Row key={`${s.source}:${s.name}`} label={s.name} hint={s.source} tokens={s.tokens} />
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-hairline px-5 py-4 last:border-b-0">
      <h3 className="mb-2 text-xs font-semibold text-ink-3">{title}</h3>
      {children}
    </section>
  );
}

function Row({
  label,
  hint,
  tokens,
  share,
  dot,
  muted,
  title,
}: {
  label: ReactNode;
  hint?: string;
  tokens: number;
  share?: string;
  dot?: string;
  muted?: boolean;
  title?: string;
}) {
  return (
    <li title={title} className="flex min-w-0 items-center gap-2 py-1 text-sm">
      {dot !== undefined ? (
        <span
          aria-hidden="true"
          className="size-2.5 flex-none rounded-sm"
          style={{ background: dot }}
        />
      ) : (
        <span aria-hidden="true" className="size-2.5 flex-none" />
      )}
      <span className={cn("min-w-0 flex-1 truncate", muted ? "text-ink-3" : "text-ink")}>
        {label}
        {hint && <span className="ml-2 text-xs text-ink-3">{hint}</span>}
      </span>
      <span className="flex-none font-mono text-xs tabular-nums text-ink-2">{compact(tokens)}</span>
      {share && (
        <span className="w-12 flex-none text-right font-mono text-xs tabular-nums text-ink-3">
          {share}
        </span>
      )}
    </li>
  );
}

/** MCP tools by server: each server's total, its tools a press away. */
function McpTools({ tools }: { tools: ContextUsage["mcpTools"] }) {
  const servers = useMemo(() => {
    const by = new Map<string, ContextUsage["mcpTools"]>();
    for (const tool of tools) by.set(tool.serverName, [...(by.get(tool.serverName) ?? []), tool]);
    return [...by].map(([name, list]) => ({
      name,
      tools: list,
      tokens: list.reduce((n, x) => n + x.tokens, 0),
      loaded: list.filter((x) => x.loaded !== false).length,
    }));
  }, [tools]);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (name: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (!next.delete(name)) next.add(name);
      return next;
    });
  return (
    <ul className="flex flex-col overflow-hidden rounded-xl border border-hairline">
      {servers.map((s) => {
        const expanded = open.has(s.name);
        return (
          <li key={s.name} className="border-b border-hairline last:border-b-0">
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => toggle(s.name)}
              className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-sm hover:bg-panel"
            >
              <ChevronRight
                size={14}
                aria-hidden="true"
                className={cn("flex-none text-ink-3 transition-transform", expanded && "rotate-90")}
              />
              <span className="min-w-0 flex-1 truncate font-medium text-ink">{s.name}</span>
              <span className="flex-none text-xs text-ink-3">
                {t("context.mcpLoaded", { loaded: s.loaded, count: s.tools.length })}
              </span>
              <span className="w-12 flex-none text-right font-mono text-xs tabular-nums text-ink-2">
                {compact(s.tokens)}
              </span>
            </button>
            {expanded && (
              <ul className="border-t border-hairline bg-panel/50 px-3 py-1">
                {s.tools.map((tool) => (
                  <li key={tool.name} className="flex min-w-0 items-center gap-2 py-1 pl-6 text-xs">
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate font-mono",
                        tool.loaded === false ? "text-ink-3" : "text-ink",
                      )}
                    >
                      {tool.name.replace(`mcp__${s.name}__`, "")}
                    </span>
                    {tool.loaded === false && (
                      <span className="flex-none text-ink-3">{t("context.notLoaded")}</span>
                    )}
                    <span className="w-12 flex-none text-right font-mono tabular-nums text-ink-2">
                      {compact(tool.tokens)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A memory file's path from the project (or home) folder, as people read it. */
function shortPath(path: string, cwd: string): string {
  if (path.startsWith(`${cwd}/`)) return path.slice(cwd.length + 1);
  const home = /^\/(?:Users|home)\/[^/]+/.exec(path)?.[0];
  return home ? `~${path.slice(home.length)}` : path;
}
