import type { TerminalInfo } from "@gravita/protocol";
import { Columns2, Plus, Rows2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { START_SIZE, TerminalView } from "@/features/terminal/TerminalView";
import { useOpenTerminal } from "@/features/terminal/useOpenTerminal";
import { t, useLocale } from "@/shared/i18n/i18n";
import { describeError } from "@/shared/presenters/errors";
import { Button } from "@/shared/ui/ui";
import { cn } from "@/shared/utils";
import { useAppStore, useTerminalControl } from "@/state/hooks";
import { type Box, boxes, type Divider, type SplitDir } from "@/state/terminalLayout";

const STEP = 0.02;

/**
 * Every open terminal on one screen, split as the user laid them out: side by side or one
 * above the other, each box resizable. Terminals are drawn as a flat list placed from the
 * layout, so splitting one never restarts the others' views.
 */
export function TerminalsScreen({ terminalId }: { terminalId?: string }) {
  useLocale();
  const layout = useAppStore((s) => s.terminalLayout);
  const focused = useAppStore((s) => s.focusedTerminal);
  const terminals = useAppStore((s) => s.terminals);
  const place = useAppStore((s) => s.placeTerminal);
  const focus = useAppStore((s) => s.focusTerminal);
  const split = useAppStore((s) => s.splitTerminal);
  const replace = useAppStore((s) => s.replaceTerminal);
  const resize = useAppStore((s) => s.resizeSplit);
  const { spawn } = useTerminalControl();
  const area = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();
  const opener = useOpenTerminal((terminal) => place(terminal.terminalId));

  // A terminal asked for by the address (the sidebar, a shared link) comes into view.
  const exists = terminalId !== undefined && terminals[terminalId] !== undefined;
  useEffect(() => {
    if (terminalId && exists) place(terminalId);
  }, [terminalId, exists, place]);

  const placed = useMemo(() => boxes(layout), [layout]);
  const open = [...placed.panes].filter(([id]) => terminals[id] !== undefined);

  const divide = async (from: TerminalInfo, dir: SplitDir) => {
    setError(undefined);
    const r = await spawn({ cwd: from.cwd, command: "shell", ...START_SIZE });
    if (r.ok) split(from.terminalId, dir, r.value.terminalId);
    else setError(t("terminal.failed", { reason: describeError(r.error).text }));
  };

  if (open.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-[1080px] flex-col items-start gap-4 px-8 pt-8">
        <h1 className="text-2xl font-bold tracking-[-0.02em]">{t("terminals.title")}</h1>
        <p className="text-ink-2">{t("terminals.empty")}</p>
        <Button variant="primary" aria-busy={opener.busy} onClick={() => void opener.open()}>
          <Plus size={15} aria-hidden="true" />
          {t("nav.newTerminal")}
        </Button>
        {opener.error && (
          <p role="alert" className="text-xs text-error-ink">
            {opener.error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {error && (
        <p role="alert" className="flex-none px-4 py-2 text-xs text-error-ink">
          {error}
        </p>
      )}
      <div ref={area} className="relative min-h-0 flex-1">
        {open.map(([id, box]) => {
          const terminal = terminals[id] as TerminalInfo;
          return (
            <Pane
              key={id}
              terminal={terminal}
              box={box}
              focused={focused === id}
              crowded={open.length > 1}
              onFocus={() => focus(id)}
              onSplit={(dir) => void divide(terminal, dir)}
              onReplaced={(next) => replace(id, next.terminalId)}
            />
          );
        })}
        {placed.dividers.map((d) => (
          <Handle
            key={d.path.join("")}
            divider={d}
            area={area}
            onResize={(ratio) => resize(d.path, ratio)}
          />
        ))}
      </div>
    </div>
  );
}

function Pane({
  terminal,
  box,
  focused,
  crowded,
  onFocus,
  onSplit,
  onReplaced,
}: {
  terminal: TerminalInfo;
  box: Box;
  focused: boolean;
  /** More than one terminal is on screen: the focused one gets an outline. */
  crowded: boolean;
  onFocus: () => void;
  onSplit: (dir: SplitDir) => void;
  onReplaced: (next: TerminalInfo) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  // Only the terminal that was focused as it opened takes the keyboard then; later changes of
  // focus move it below (changing this prop would restart the terminal's view).
  const [autoFocus] = useState(focused);

  useEffect(() => {
    const root = el.current;
    if (!focused || !root || root.contains(document.activeElement)) return;
    root.querySelector<HTMLElement>(".xterm-helper-textarea")?.focus();
  }, [focused]);

  return (
    <div
      ref={el}
      onFocusCapture={onFocus}
      onPointerDownCapture={onFocus}
      style={{
        left: `${box.x * 100}%`,
        top: `${box.y * 100}%`,
        width: `${box.w * 100}%`,
        height: `${box.h * 100}%`,
      }}
      className={cn(
        "absolute min-h-0 min-w-0 overflow-hidden border border-hairline",
        crowded && focused && "border-focus",
      )}
    >
      <TerminalView
        terminal={terminal}
        autoFocus={autoFocus}
        onReplaced={onReplaced}
        actions={
          <>
            <PaneButton label={t("terminals.splitRight")} onClick={() => onSplit("row")}>
              <Columns2 size={14} aria-hidden="true" />
            </PaneButton>
            <PaneButton label={t("terminals.splitDown")} onClick={() => onSplit("col")}>
              <Rows2 size={14} aria-hidden="true" />
            </PaneButton>
          </>
        }
      />
    </div>
  );
}

function PaneButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex size-6 flex-none items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-panel hover:text-ink"
    >
      {children}
    </button>
  );
}

/** The line between two boxes: drag it, or use the arrow keys on it, to resize them. */
function Handle({
  divider,
  area,
  onResize,
}: {
  divider: Divider;
  area: React.RefObject<HTMLDivElement | null>;
  onResize: (ratio: number) => void;
}) {
  const { box, dir, ratio } = divider;
  const row = dir === "row";
  const along = (row ? box.x + box.w * ratio : box.y + box.h * ratio) * 100;
  const move = (e: React.PointerEvent) => {
    const rect = area.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return;
    const [start, size, at, total] = row
      ? [box.x, box.w, e.clientX - rect.left, rect.width]
      : [box.y, box.h, e.clientY - rect.top, rect.height];
    onResize((at / total - start) / size);
  };
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={t("terminals.resize")}
      aria-orientation={row ? "vertical" : "horizontal"}
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={15}
      aria-valuemax={85}
      onPointerDown={(e) => e.currentTarget.setPointerCapture?.(e.pointerId)}
      onPointerMove={(e) => {
        if (e.buttons === 1) move(e);
      }}
      onKeyDown={(e) => {
        const back = row ? "ArrowLeft" : "ArrowUp";
        const forward = row ? "ArrowRight" : "ArrowDown";
        if (e.key !== back && e.key !== forward) return;
        e.preventDefault();
        onResize(ratio + (e.key === forward ? STEP : -STEP));
      }}
      style={
        row
          ? { left: `${along}%`, top: `${box.y * 100}%`, height: `${box.h * 100}%` }
          : { top: `${along}%`, left: `${box.x * 100}%`, width: `${box.w * 100}%` }
      }
      className={cn(
        "group absolute z-10 flex items-center justify-center outline-none",
        row ? "w-2 -translate-x-1/2 cursor-col-resize" : "h-2 -translate-y-1/2 cursor-row-resize",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "bg-transparent transition-colors group-hover:bg-focus group-focus-visible:bg-focus",
          row ? "h-full w-0.5" : "h-0.5 w-full",
        )}
      />
    </div>
  );
}
