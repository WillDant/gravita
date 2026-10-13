import { memo, useMemo } from "react";
import { type Block, type Inline, parseMessage } from "./parseMessage";

/** A message's text as paragraphs, lists and code. Text nodes only, never HTML. */
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
    case "code":
      return (
        <pre
          data-lang={b.lang}
          className="overflow-x-auto rounded-lg bg-panel px-3 py-2.5 font-mono text-xs leading-relaxed text-ink"
        >
          <code>{b.text}</code>
        </pre>
      );
  }
}

function Inlines({ inlines }: { inlines: Inline[] }) {
  return inlines.map((run, i) => {
    const key = `${run.kind}-${i}`;
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
