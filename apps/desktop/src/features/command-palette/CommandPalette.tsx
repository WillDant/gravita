import {
  BellDot,
  CircleStop,
  Folder,
  Languages,
  MessageSquare,
  Moon,
  Plus,
  Search,
  Settings,
  SquareTerminal,
  Sun,
  UsersRound,
} from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useMemo, useState } from "react";
import { useNavigate, useTheme, useToggleTheme } from "@/app/providers";
import { stoppedAllNotice } from "@/application/tray/traySync";
import { useOpenTerminal } from "@/features/terminal/useOpenTerminal";
import { getLocale, setLocale, t, useLocale } from "@/shared/i18n/i18n";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { cn } from "@/shared/utils";
import { useAppStore, useNow, useProjection, useTerminalSupported } from "@/state/hooks";
import {
  buildCommands,
  type PaletteCommand,
  type PaletteGroup,
  type PaletteResult,
  paletteResults,
} from "./commands";

/** The ⌘K palette: jump to any session, project, squad or terminal, or run an app action. */
export function CommandPalette() {
  const open = useAppStore((s) => s.paletteOpen);
  const setOpen = useAppStore((s) => s.setPaletteOpen);
  // "Stop all agents" asks first; the palette steps aside while it does.
  const [confirmStop, setConfirmStop] = useState(false);
  if (confirmStop) return <StopAllConfirm onDone={() => setConfirmStop(false)} />;
  if (!open) return null;
  return (
    <PaletteDialog
      onClose={() => setOpen(false)}
      onStopAll={() => {
        setOpen(false);
        setConfirmStop(true);
      }}
    />
  );
}

function PaletteDialog({ onClose, onStopAll }: { onClose: () => void; onStopAll: () => void }) {
  useLocale();
  const state = useProjection((p) => p);
  const terminals = useAppStore((s) => s.terminals);
  const placeTerminal = useAppStore((s) => s.placeTerminal);
  const now = useNow();
  const terminalsSupported = useTerminalSupported();
  const theme = useTheme();
  const toggleTheme = useToggleTheme();
  const navigate = useNavigate();
  const newTerminal = useOpenTerminal((terminal) => {
    placeTerminal(terminal.terminalId);
    navigate({ level: "terminals", terminalId: terminal.terminalId });
    onClose();
  });
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;

  const commands = useMemo(
    () =>
      buildCommands({
        state,
        terminals,
        now,
        terminalsSupported,
        theme,
        locale: getLocale(),
      }),
    [state, terminals, now, terminalsSupported, theme],
  );
  const groups = useMemo(() => paletteResults(commands, query), [commands, query]);
  const flat = useMemo(() => groups.flatMap((g) => g.results), [groups]);
  const current = Math.min(active, flat.length - 1);

  // Focus goes back where it was (the composer, a terminal) when the palette closes. Read
  // during the first render: autoFocus has already moved it by the time effects run.
  const [before] = useState(() => document.activeElement);
  useEffect(
    () => () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus();
    },
    [before],
  );

  useEffect(() => {
    if (current >= 0)
      document.getElementById(optionId(current))?.scrollIntoView?.({ block: "nearest" });
  });

  const run = (command: PaletteCommand) => {
    const target = command.target;
    if (target.kind === "route") {
      navigate(target.route);
      onClose();
    } else if (target.kind === "terminal") {
      placeTerminal(target.terminalId);
      navigate({ level: "terminals", terminalId: target.terminalId });
      onClose();
    } else if (target.action === "newTerminal") {
      // Stays open until the terminal exists, so a failure shows here.
      void newTerminal.open();
    } else if (target.action === "toggleTheme") {
      toggleTheme();
      onClose();
    } else if (target.action === "switchLanguage") {
      setLocale(getLocale() === "en" ? "pt-BR" : "en");
      onClose();
    } else {
      onStopAll();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (flat.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((current + step + flat.length) % flat.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = flat[current];
      if (hit) run(hit.command);
    } else if (e.key === "Escape") {
      // Only the palette closes, not the panel behind it.
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  let index = -1;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
      {/* Pressing the dimmed backdrop closes; the keyboard has Escape, so it skips the tab order. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onMouseDown={onClose}
        className="absolute inset-0 cursor-default bg-scrim"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("palette.title")}
        className="reveal relative flex max-h-[min(560px,70vh)] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-hairline bg-panel shadow-panel"
      >
        <div className="flex flex-none items-center gap-2.5 border-b border-hairline px-4">
          <Search size={16} aria-hidden="true" className="flex-none text-ink-3" />
          <input
            // biome-ignore lint/a11y/noAutofocus: the palette exists to be typed into.
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls={listId}
            aria-label={t("palette.title")}
            {...(current >= 0 ? { "aria-activedescendant": optionId(current) } : {})}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={t("palette.placeholder")}
            spellCheck={false}
            autoComplete="off"
            className="h-12 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
          />
        </div>
        {newTerminal.error && (
          <p role="alert" className="flex-none px-4 pt-2 text-xs text-error-ink">
            {newTerminal.error}
          </p>
        )}
        <div
          id={listId}
          role="listbox"
          aria-label={t("palette.title")}
          className="min-h-0 flex-1 overflow-y-auto p-2"
        >
          {flat.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-ink-3">
              {t("palette.empty", { query: query.trim() })}
            </p>
          ) : (
            groups.map(({ group, results }) => (
              <div key={group} role="group" aria-labelledby={`${listId}-${group}`}>
                <div
                  id={`${listId}-${group}`}
                  role="presentation"
                  className="px-3 pt-2 pb-1 text-xs font-semibold text-ink-3"
                >
                  {t(`palette.group.${group}`)}
                </div>
                {results.map((result) => {
                  index++;
                  const i = index;
                  return (
                    <Option
                      key={result.command.id}
                      id={optionId(i)}
                      result={result}
                      selected={i === current}
                      busy={result.command.id === "action:newTerminal" && newTerminal.busy}
                      theme={theme}
                      onHover={() => setActive(i)}
                      onPick={() => run(result.command)}
                    />
                  );
                })}
              </div>
            ))
          )}
        </div>
        <p className="flex-none border-t border-hairline px-4 py-2 text-2xs text-ink-3">
          {t("palette.hint")}
        </p>
      </div>
    </div>
  );
}

function Option({
  id,
  result,
  selected,
  busy,
  theme,
  onHover,
  onPick,
}: {
  id: string;
  result: PaletteResult;
  selected: boolean;
  busy: boolean;
  theme: string;
  onHover: () => void;
  onPick: () => void;
}) {
  const { command, indices } = result;
  return (
    // The input owns the keyboard (arrows and return); the pointer can pick a row too.
    // biome-ignore lint/a11y/useKeyWithClickEvents: keys are handled by the combobox input.
    <div
      id={id}
      role="option"
      // Reachable through the input's aria-activedescendant, never on its own in the tab order.
      tabIndex={-1}
      aria-selected={selected}
      {...(busy ? { "aria-busy": true } : {})}
      onMouseMove={onHover}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick}
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm",
        selected ? "bg-sidebar-active text-ink shadow-panel" : "text-ink-2",
      )}
    >
      <span aria-hidden="true" className="flex-none text-ink-3">
        {iconOf(command, theme)}
      </span>
      <span className="min-w-0 flex-1 truncate">
        <Highlight text={command.label} indices={indices} />
      </span>
      {command.detail && (
        <span className="max-w-[45%] flex-none truncate text-xs text-ink-3">{command.detail}</span>
      )}
    </div>
  );
}

/** The label with the letters the query matched in bold. */
function Highlight({ text, indices }: { text: string; indices: number[] }) {
  if (indices.length === 0) return <>{text}</>;
  const marked = new Set(indices);
  const parts: { text: string; mark: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const mark = marked.has(i);
    const last = parts[parts.length - 1];
    if (last && last.mark === mark) last.text += text[i];
    else parts.push({ text: text[i] as string, mark });
  }
  return (
    <>
      {parts.map((p, i) =>
        p.mark ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts never reorder.
          <mark key={i} className="bg-transparent font-semibold text-ink">
            {p.text}
          </mark>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts never reorder.
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

const GROUP_ICON: Record<PaletteGroup, typeof Search> = {
  needsYou: BellDot,
  actions: Plus,
  sessions: MessageSquare,
  squads: UsersRound,
  projects: Folder,
  terminals: SquareTerminal,
};

function iconOf(command: PaletteCommand, theme: string) {
  const target = command.target;
  let Icon = GROUP_ICON[command.group];
  if (command.id === "action:settings") Icon = Settings;
  else if (target.kind === "action") {
    if (target.action === "newTerminal") Icon = SquareTerminal;
    else if (target.action === "toggleTheme") Icon = theme === "dark" ? Sun : Moon;
    else if (target.action === "switchLanguage") Icon = Languages;
    else if (target.action === "stopAll") Icon = CircleStop;
  }
  return <Icon size={16} />;
}

/** The kill switch from the palette: confirm, stop, then the same notice the tray shows. */
function StopAllConfirm({ onDone }: { onDone: () => void }) {
  const stopAll = useAppStore((s) => s.stopAll);
  const showNotice = useAppStore((s) => s.showNotice);
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    const r = await stopAll();
    const { key, params } = stoppedAllNotice(r.ok ? r.value : { error: r.error.message });
    showNotice(key, params);
    onDone();
  };
  return (
    <ConfirmDialog
      title={t("palette.stopAll.title")}
      message={t("palette.stopAll.message")}
      confirmLabel={t("palette.stopAll.confirm")}
      busy={busy}
      onConfirm={() => void confirm()}
      onCancel={onDone}
    />
  );
}
