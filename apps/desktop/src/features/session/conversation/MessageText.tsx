import { memo, useMemo } from "react";
import { useOpenExternal } from "@/app/providers";
import { t } from "@/shared/i18n/i18n";
import { CopyButton } from "@/shared/ui/CopyButton";
import { cn } from "@/shared/utils";
import { type Block, type Inline, parseMessage, type TableAlign } from "./parseMessage";

const CELL_ALIGN: Record<NonNullable<TableAlign>, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};
const cellAlign = (align: TableAlign | undefined) => CELL_ALIGN[align ?? "left"];

/** A message's text as paragraphs, lists, tables and code. Text nodes only, never HTML. */
export const MessageText = memo(function MessageText({ text }: { text: string }) {
  const blocks = useMemo(() => parseMessage(text), [text]);
  return (
    <div className="flex min-w-0 flex-col gap-2.5 text-base leading-relaxed text-ink">
      {blocks.map((b, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: blocks are positional text.
        <BlockView key={i} block={b} />
      ))}
    </div>
  );
});

function BlockView({ block: b }: { block: Block }) {
  switch (b.kind) {
    case "paragraph":
      return (
        <p className="whitespace-pre-line break-words">
          <Inlines inlines={b.inlines} />
        </p>
      );
    case "heading":
      return (
        <p className="pt-1 font-semibold">
          <Inlines inlines={b.inlines} />
        </p>
      );
    case "list": {
      const items = b.items.map((item, j) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: items are positional text.
        <li key={j} className="pl-1 break-words">
          <Inlines inlines={item} />
        </li>
      ));
      return b.ordered ? (
        <ol start={b.start} className="flex list-decimal flex-col gap-1 pl-5">
          {items}
        </ol>
      ) : (
        <ul className="flex list-disc flex-col gap-1 pl-5 marker:text-ink-3">{items}</ul>
      );
    }
    case "table":
      return (
        <div className="overflow-x-auto rounded-lg border border-hairline">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-panel">
              <tr>
                {b.header.map((cell, c) => (
                  <th
                    // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional text.
                    key={c}
                    scope="col"
                    className={cn(
                      "border-b border-hairline px-3 py-2 align-bottom font-semibold",
                      cellAlign(b.align[c]),
                    )}
                  >
                    <Inlines inlines={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((row, r) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional text.
                <tr key={r} className="border-b border-hairline last:border-b-0">
                  {row.map((cell, c) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional text.
                    <td key={c} className={cn("px-3 py-2 align-top", cellAlign(b.align[c]))}>
                      <Inlines inlines={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "code":
      return (
        <div className="group/code relative">
          <pre
            data-lang={b.lang}
            className="overflow-x-auto rounded-lg bg-panel px-3 py-2.5 pr-10 font-mono text-xs leading-relaxed text-ink"
          >
            <code>{b.text}</code>
          </pre>
          <CopyButton
            text={b.text}
            label={t("conversation.copyCode")}
            className="absolute top-1.5 right-1.5 opacity-0 group-hover/code:opacity-100 focus-visible:opacity-100"
          />
        </div>
      );
  }
}

/**
 * A web link, always handed to the user's browser: the default action is cancelled so the
 * webview itself never navigates away. Hovering shows where it really goes, since the label
 * is whatever the agent wrote.
 */
function MessageLink({ run }: { run: Extract<Inline, { kind: "link" }> }) {
  const openExternal = useOpenExternal();
  return (
    <a
      href={run.href}
      title={run.href}
      rel="noreferrer"
      className={cn(
        "break-words text-link underline underline-offset-2",
        run.strong && "font-semibold",
      )}
      onClick={(e) => {
        e.preventDefault();
        void openExternal(run.href).catch(() => {});
      }}
    >
      {run.text}
    </a>
  );
}

function Inlines({ inlines }: { inlines: Inline[] }) {
  return inlines.map((run, i) => {
    const key = `${run.kind}-${i}`;
    if (run.kind === "link") return <MessageLink key={key} run={run} />;
    if (run.kind === "code") {
      return (
        <code key={key} className="rounded bg-panel px-1 py-px font-mono text-[0.86em] text-ink">
          {run.text}
        </code>
      );
    }
    if (run.kind === "strong") {
      return (
        <strong key={key} className="font-semibold">
          {run.text}
        </strong>
      );
    }
    return <span key={key}>{run.text}</span>;
  });
}
