// Holds the desktop UI to its bundle budget (gzip): the entry chunk under 250 KB and
// everything the first paint loads (JS + CSS) under 300 KB. Lazy chunks (lenses opened
// on demand) are reported but don't count. Run after `pnpm --filter @gravita/desktop build`.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const KB = 1024;
const ENTRY_MAX = 250 * KB;
const INITIAL_MAX = 300 * KB;

const dist = join(import.meta.dir, "../apps/desktop/dist");
const assets = join(dist, "assets");

let html: string;
try {
  html = readFileSync(join(dist, "index.html"), "utf8");
} catch {
  console.error(`no build at ${dist}: run pnpm --filter @gravita/desktop build first`);
  process.exit(1);
}

const files = readdirSync(assets).filter((f) => f.endsWith(".js") || f.endsWith(".css"));
const read = (f: string) => readFileSync(join(assets, f));
const gzip = (f: string) => Bun.gzipSync(read(f)).length;

// What the first paint loads: the tags in index.html, then every chunk they import
// statically. `import("./x.js")` is a lazy chunk and stops the walk.
const tagged = [...html.matchAll(/(?:src|href)="\/assets\/([^"]+\.(?:js|css))"/g)].map(
  (m) => m[1]!,
);
const entry = tagged.find((f) => /^index-.*\.js$/.test(f));
if (!entry) {
  console.error("index.html loads no index-*.js entry chunk");
  process.exit(1);
}
const initial = new Set<string>();
const queue = [...tagged];
for (let f = queue.shift(); f !== undefined; f = queue.shift()) {
  if (initial.has(f)) continue;
  initial.add(f);
  if (!f.endsWith(".js")) continue;
  const code = read(f).toString("utf8");
  for (const m of code.matchAll(/(?:from|import)\s*["']\.\/([^"']+\.js)["']/g)) queue.push(m[1]!);
}

interface Row {
  file: string;
  kind: "entry" | "initial" | "lazy";
  raw: number;
  gz: number;
}
const rows: Row[] = files
  .map((file) => ({
    file,
    kind: file === entry ? "entry" : initial.has(file) ? "initial" : "lazy",
    raw: read(file).length,
    gz: gzip(file),
  }))
  .sort((a, b) => a.kind.localeCompare(b.kind) || b.gz - a.gz) as Row[];

const kb = (n: number) => `${(n / KB).toFixed(1)} KB`.padStart(10);
console.log(`${"chunk".padEnd(44)}${"kind".padEnd(9)}${"raw".padStart(10)}${"gzip".padStart(10)}`);
for (const r of rows) console.log(`${r.file.padEnd(44)}${r.kind.padEnd(9)}${kb(r.raw)}${kb(r.gz)}`);

const entryGz = rows.find((r) => r.kind === "entry")!.gz;
const initialGz = rows.filter((r) => r.kind !== "lazy").reduce((sum, r) => sum + r.gz, 0);
const lazyGz = rows.filter((r) => r.kind === "lazy").reduce((sum, r) => sum + r.gz, 0);
console.log(
  `\nentry ${kb(entryGz).trim()} / ${ENTRY_MAX / KB} KB · initial ${kb(initialGz).trim()} / ${INITIAL_MAX / KB} KB · lazy ${kb(lazyGz).trim()} (gzip)`,
);

const over = [
  entryGz > ENTRY_MAX && `entry chunk ${entry} is over ${ENTRY_MAX / KB} KB gzip`,
  initialGz > INITIAL_MAX && `initial JS+CSS is over ${INITIAL_MAX / KB} KB gzip`,
].filter(Boolean);
if (over.length) {
  for (const o of over) console.error(`✗ ${o}`);
  process.exit(1);
}
console.log("✓ within the bundle budget");
