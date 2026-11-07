// A tiny reader for the Markdown agents write: paragraphs, headings, bullet and numbered
// lists, tables, fenced code, inline code, bold and web links. It only ever produces text
// runs, so the renderer builds plain text nodes and no message can inject markup.

import { isExternalUrl } from "@/shared/externalUrl";

export type Inline =
  | { kind: "text" | "code" | "strong"; text: string }
  | { kind: "link"; text: string; href: string; strong?: boolean };

export type TableAlign = "left" | "center" | "right" | null;

export type Block =
  | { kind: "paragraph"; inlines: Inline[] }
  | { kind: "heading"; inlines: Inline[] }
  | { kind: "list"; ordered: boolean; start: number; items: Inline[][] }
  | { kind: "table"; align: TableAlign[]; header: Inline[][]; rows: Inline[][][] }
  | { kind: "code"; lang?: string; text: string };

const FENCE = /^\s{0,3}(```|~~~)\s*([\w+#.-]*)\s*$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,9})[.)]\s+(.*)$/;
const TABLE_DELIMITER = /^\s{0,3}\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
// Code, then bold, then `[label](url "title")` (one level of parentheses in the url), then a
// bare url. Code comes first, so nothing inside backticks becomes a link.
const INLINE =
  /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\(([^()\s]*(?:\([^()\s]*\)[^()\s]*)*)(?:\s+"[^"\n]*")?\)|(https?:\/\/[^\s<>`]+)/gi;

const count = (text: string, char: string) => text.split(char).length - 1;

/** A bare url without the sentence around it: closing punctuation and unpaired brackets. */
function trimBareUrl(raw: string): string {
  let url = raw;
  while (url) {
    const end = url.at(-1) as string;
    const unpaired =
      (end === ")" && count(url, ")") > count(url, "(")) ||
      (end === "]" && count(url, "]") > count(url, "["));
    if (!unpaired && !".,;:!?'\"*_~…".includes(end)) break;
    url = url.slice(0, -1);
  }
  return url;
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const pushText = (run: string) => {
    if (!run) return;
    const previous = out.at(-1);
    if (previous?.kind === "text") previous.text += run;
    else out.push({ kind: "text", text: run });
  };
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index;
    pushText(text.slice(last, at));
    last = at + m[0].length;
    if (m[1] !== undefined) {
      out.push({ kind: "code", text: m[1] });
    } else if (m[2] !== undefined) {
      for (const run of parseInline(m[2])) {
        if (run.kind === "text") out.push({ kind: "strong", text: run.text });
        else if (run.kind === "link") out.push({ ...run, strong: true });
        else out.push(run);
      }
    } else if (m[3] !== undefined) {
      const href = m[4]!;
      if (isExternalUrl(href)) {
        out.push({ kind: "link", text: m[3].replace(/`|\*\*/g, ""), href });
      } else {
        // Not a web link (a file path, `javascript:`): the label still reads as Markdown.
        pushText("[");
        for (const run of parseInline(m[3])) {
          if (run.kind === "text") pushText(run.text);
          else out.push(run);
        }
        pushText(`](${m[0].slice(m[3].length + 3)}`);
      }
    } else {
      const href = trimBareUrl(m[5]!);
      if (isExternalUrl(href)) {
        out.push({ kind: "link", text: href, href });
        last = at + href.length;
      } else {
        pushText(m[0]);
      }
    }
  }
  pushText(text.slice(last));
  return out;
}

/** A table row's cells; `\|` is a literal pipe, and the outer pipes are optional. */
function splitRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
  const cells: string[] = [];
  let cell = "";
  for (let i = 0; i < row.length; i++) {
    if (row[i] === "\\" && row[i + 1] === "|") {
      cell += "|";
      i++;
    } else if (row[i] === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += row[i];
    }
  }
  cells.push(cell.trim());
  return cells;
}

function columnAlign(delimiter: string): TableAlign {
  const left = delimiter.startsWith(":");
  const right = delimiter.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  return left ? "left" : null;
}

/** The table starting at `lines[at]`, if a matching delimiter row follows its header. */
function readTable(
  lines: string[],
  at: number,
): { block: Extract<Block, { kind: "table" }>; end: number } | undefined {
  const headerLine = lines[at]!;
  const delimiterLine = lines[at + 1];
  if (
    delimiterLine === undefined ||
    !headerLine.includes("|") ||
    !delimiterLine.includes("|") ||
    !TABLE_DELIMITER.test(delimiterLine)
  ) {
    return undefined;
  }
  const header = splitRow(headerLine);
  const delimiter = splitRow(delimiterLine);
  if (header.length !== delimiter.length) return undefined;

  const rows: Inline[][][] = [];
  let end = at + 2;
  for (; end < lines.length && lines[end]!.trim() && lines[end]!.includes("|"); end++) {
    const cells = splitRow(lines[end]!);
    // Short rows are filled in; extra cells are dropped.
    rows.push(header.map((_, c) => parseInline(cells[c] ?? "")));
  }
  return {
    block: {
      kind: "table",
      align: delimiter.map(columnAlign),
      header: header.map(parseInline),
      rows,
    },
    end: end - 1,
  };
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
    const table = readTable(lines, i);
    if (table) {
      flushPara();
      flushList();
      blocks.push(table.block);
      i = table.end;
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
