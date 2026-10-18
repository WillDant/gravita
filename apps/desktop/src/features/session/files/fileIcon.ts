import {
  BookOpen,
  Container,
  File,
  FileBraces,
  FileCode,
  FileCog,
  FileImage,
  FileTerminal,
  FileText,
  FileType,
  Folder,
  FolderOpen,
  Lock,
  type LucideIcon,
  Package,
  Scale,
  Settings,
} from "lucide-react";

// The explorer's icons: folders in blue, the main file types each with their own icon and
// colour (tokens in styles.css, one value per theme). Anything else stays a plain grey file.

export interface FileIcon {
  Icon: LucideIcon;
  className: string;
}

const PLAIN: FileIcon = { Icon: File, className: "text-ink-3" };

const TS: FileIcon = { Icon: FileCode, className: "text-file-ts" };
const JS: FileIcon = { Icon: FileCode, className: "text-file-js" };
const JSON_: FileIcon = { Icon: FileBraces, className: "text-file-json" };
const STYLE: FileIcon = { Icon: FileType, className: "text-file-style" };
const MARKUP: FileIcon = { Icon: FileCode, className: "text-file-markup" };
const MD: FileIcon = { Icon: FileText, className: "text-file-md" };
const PY: FileIcon = { Icon: FileCode, className: "text-file-py" };
const RS: FileIcon = { Icon: FileCode, className: "text-file-rs" };
const IMAGE: FileIcon = { Icon: FileImage, className: "text-file-image" };
const CONFIG: FileIcon = { Icon: FileCog, className: "text-file-config" };
const SHELL: FileIcon = { Icon: FileTerminal, className: "text-file-shell" };
const LOCK: FileIcon = { Icon: Lock, className: "text-file-lock" };

const BY_NAME: Readonly<Record<string, FileIcon>> = {
  "package.json": { Icon: Package, className: "text-file-json" },
  "pnpm-lock.yaml": LOCK,
  "package-lock.json": LOCK,
  "bun.lock": LOCK,
  "bun.lockb": LOCK,
  "yarn.lock": LOCK,
  "cargo.lock": LOCK,
  dockerfile: { Icon: Container, className: "text-file-ts" },
  ".gitignore": { Icon: Settings, className: "text-file-config" },
  ".gitattributes": { Icon: Settings, className: "text-file-config" },
  ".editorconfig": { Icon: Settings, className: "text-file-config" },
  license: { Icon: Scale, className: "text-file-lock" },
};

const BY_EXT: Readonly<Record<string, FileIcon>> = {
  ts: TS,
  tsx: TS,
  mts: TS,
  cts: TS,
  js: JS,
  jsx: JS,
  mjs: JS,
  cjs: JS,
  json: JSON_,
  jsonc: JSON_,
  css: STYLE,
  scss: STYLE,
  html: MARKUP,
  htm: MARKUP,
  vue: MARKUP,
  svelte: MARKUP,
  xml: MARKUP,
  md: MD,
  mdx: MD,
  py: PY,
  rs: RS,
  png: IMAGE,
  jpg: IMAGE,
  jpeg: IMAGE,
  gif: IMAGE,
  svg: IMAGE,
  webp: IMAGE,
  ico: IMAGE,
  yml: CONFIG,
  yaml: CONFIG,
  toml: CONFIG,
  ini: CONFIG,
  env: CONFIG,
  sh: SHELL,
  zsh: SHELL,
  bash: SHELL,
  lock: LOCK,
};

/** A file's icon by its name: special names first (package.json, a lockfile…), then its extension. */
export function fileIcon(name: string): FileIcon {
  const lower = name.toLowerCase();
  const named = BY_NAME[lower];
  if (named) return named;
  if (lower.startsWith("readme")) return { Icon: BookOpen, className: "text-file-md" };
  if (lower === ".env" || lower.startsWith(".env.")) return CONFIG;
  if (lower.startsWith("license.")) return BY_NAME.license ?? PLAIN;
  const dot = lower.lastIndexOf(".");
  if (dot <= 0) return PLAIN;
  return BY_EXT[lower.slice(dot + 1)] ?? PLAIN;
}

export function folderIcon(open: boolean): FileIcon {
  return { Icon: open ? FolderOpen : Folder, className: "text-file-folder" };
}
