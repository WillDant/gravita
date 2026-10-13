// A tiny reader for the Markdown agents write: paragraphs, headings, bullet and numbered
// lists, fenced code, inline code and bold. It only ever produces text runs, so the
// renderer builds plain text nodes and no message can inject markup.

export type Inline = { kind: "text" | "code" | "strong"; text: string };

export type Block =
  | { kind: "paragraph"; inlines: Inline[] }
  | { kind: "heading"; inlines: Inline[] }
  | { kind: "list"; ordered: boolean; start: number; items: Inline[][] }
  | { kind: "code"; lang?: string; text: string };

const FENCE = /^\s{0,3}(```|~~~)\s*([\w+#.-]*)\s*$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,9})[.)]\s+(.*)$/;
const INLINE = /`([^`\n]+)`|\*\*([^*\n]+)\*\*/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: "text", text: text.slice(last, at) });
    if (m[1] !== undefined) out.push({ kind: "code", text: m[1] });
    else out.push({ kind: "strong", text: m[2]! });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

export function parseMessage(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; start: number; items: string[] } | undefined;

  const flushPara = () => {
    if (para.length > 0) blocks.push({ kind: "paragraph", inlines: parseInline(para.join("\n")) });
    para = [];
  };
  const flushList = () => {
    if (list) {
      blocks.push({
        kind: "list",
        ordered: list.ordered,
        start: list.start,
        items: list.items.map(parseInline),
      });
    }
    list = undefined;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = FENCE.exec(line);
    if (fence) {
      flushPara();
      flushList();
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i]!.trim().startsWith(fence[1]!); i++) {
        body.push(lines[i]!);
      }
      blocks.push({ kind: "code", ...(fence[2] ? { lang: fence[2] } : {}), text: body.join("\n") });
      continue;
    }
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flushPara();
      flushList();
      blocks.push({ kind: "heading", inlines: parseInline(heading[1]!) });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      flushPara();
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, start: numbered ? Number(numbered[1]) : 1, items: [] };
      list.items.push(bullet ? bullet[1]! : numbered![2]!);
      continue;
    }
    if (list && /^\s+/.test(line)) {
      // An indented line continues the previous item.
      const lastIndex = list.items.length - 1;
      list.items[lastIndex] = `${list.items[lastIndex]} ${line.trim()}`;
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return blocks;
}
