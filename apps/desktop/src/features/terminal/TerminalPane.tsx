import "@xterm/xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import { useGateway } from "@/app/providers";
import { t } from "@/shared/i18n/i18n";
import { chunks, TERMINAL_THEME } from "./terminalTheme";

/**
 * One engine terminal drawn with xterm. It attaches on mount (what was printed so far, then
 * the live stream), sends keystrokes back, and follows its box's size.
 */
export default function TerminalPane({
  terminalId,
  autoFocus = true,
}: {
  terminalId: string;
  autoFocus?: boolean;
}) {
  const gateway = useGateway();
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const term = new Terminal({
      fontFamily: '"DM Mono", ui-monospace, "SF Mono", Menlo, monospace',
      fontSize: 12.5,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 5_000,
      allowProposedApi: false,
      macOptionIsMeta: true,
      theme: TERMINAL_THEME,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);

    // What arrives before the attach answers is already in its scrollback.
    let attached = false;
    const offOutput = gateway.onTerminalOutput((o) => {
      if (attached && o.terminalId === terminalId) term.write(o.data);
    });
    let disposed = false;
    gateway.attachTerminal({ terminalId }).then(
      ({ scrollback }) => {
        if (disposed) return;
        attached = true;
        if (scrollback) term.write(scrollback);
      },
      () => {
        if (!disposed) setFailed(true);
      },
    );

    const input = term.onData((data) => {
      for (const piece of chunks(data)) void gateway.writeTerminal({ terminalId, data: piece });
    });

    let size = { cols: 0, rows: 0 };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const resize = () => {
      // A hidden pane (the map shown alone) has no size: keep the last one.
      if (!el.clientWidth || !el.clientHeight) return;
      try {
        fit.fit();
      } catch {
        return;
      }
      if (term.cols === size.cols && term.rows === size.rows) return;
      size = { cols: term.cols, rows: term.rows };
      clearTimeout(timer);
      timer = setTimeout(() => {
        void gateway
          .resizeTerminal({ terminalId, cols: size.cols, rows: size.rows })
          .catch(() => {});
      }, 60);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    if (autoFocus) term.focus();

    return () => {
      disposed = true;
      clearTimeout(timer);
      ro.disconnect();
      offOutput();
      input.dispose();
      term.dispose();
    };
  }, [gateway, terminalId, autoFocus]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0f1115]">
      {failed && (
        <p role="alert" className="flex-none px-4 py-2 text-xs text-[#ff8b80]">
          {t("terminal.attachFailed")}
        </p>
      )}
      <div
        ref={host}
        role="region"
        aria-label={t("terminal.label")}
        className="min-h-0 flex-1 px-3 pt-2 pb-1"
      />
    </div>
  );
}
