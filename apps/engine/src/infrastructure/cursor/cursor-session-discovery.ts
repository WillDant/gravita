import type { Dirent } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { nodeRolloutFs, type RolloutFs } from "@gravita/adapter-codex";
import {
  type CursorChildFile,
  cursorSessionId,
  type TranscriptDigest,
  updateDigest,
} from "@gravita/adapter-cursor";
import type { Clock } from "../../application/ports/clock";
import type { FoundSession } from "../../application/ports/session-source";

// Finds the chats `cursor-agent` is running (or ran) in a terminal, and the subagents each one
// started. Read-only, and only ever two places under the Cursor home (ADR 008):
//   projects/<folder>/agent-transcripts/<chat>/<chat>.jsonl   what the agent did
//   chats/<hash>/<chat>/meta.json                             the chat's folder, title, start
// Never the login, `cli-config.json`, `mcp-auth.json`, the SQLite stores or `acp-sessions/`.
// Symlinks are never followed. A transcript without a `meta.json` is not a terminal chat of
// the Cursor CLI (the editor keeps none), so it is left alone.

const DAY_MS = 86_400_000;
/** A transcript that no other one claimed as its subagent's waits this long to be sure. */
const CLAIM_GRACE_MS = 3_000;
/** A chat with no `meta.json` is looked for again this rarely (the editor's never have one). */
const META_RETRY_MS = 10_000;

/** What a chat's `meta.json` says; all Gravita needs from it. */
export interface CursorChatMeta {
  cwd: string;
  title?: string;
  createdAtMs: number;
}

export interface CursorFoundSession extends FoundSession {
  chatId: string;
  meta: CursorChatMeta;
  children: CursorChildFile[];
}

/** The directory calls discovery makes, injectable so tests can audit every path it touches. */
export interface CursorDiscoveryFs {
  readdir(path: string): Promise<Dirent[]>;
  /** Like `lstat`: a symlink reports itself. */
  stat(path: string): Promise<{ mtimeMs: number; size: number; isFile: boolean }>;
}

export const nodeCursorDiscoveryFs: CursorDiscoveryFs = {
  readdir: (path) => readdir(path, { withFileTypes: true }),
  async stat(path) {
    const s = await lstat(path);
    return { mtimeMs: s.mtimeMs, size: s.size, isFile: s.isFile() };
  },
};

export interface CursorSessionDiscoveryOptions {
  /** The Cursor home (`~/.cursor`). */
  cursorHome: string;
  lookbackDays: number;
  clock: Clock;
  fs?: CursorDiscoveryFs;
  /** How transcripts and metadata are read. */
  rolloutFs?: RolloutFs;
  onSkip?: (path: string, reason: string) => void;
}

interface Candidate {
  chatId: string;
  path: string;
  mtimeMs: number;
  size: number;
  digest: TranscriptDigest;
  /** The chat that holds it as a subagent, by the folder it lies in (older Cursor versions). */
  folderParent?: string;
}

const isDir = (e: Dirent) => e.isDirectory() && !e.isSymbolicLink();

export class CursorSessionDiscovery {
  private readonly fs: CursorDiscoveryFs;
  private readonly rolloutFs: RolloutFs;
  private readonly digests = new Map<string, TranscriptDigest>();
  private readonly firstSeen = new Map<string, number>();
  private readonly metas = new Map<string, { path: string; meta: CursorChatMeta }>();
  private readonly metaMisses = new Map<string, number>();

  constructor(private readonly o: CursorSessionDiscoveryOptions) {
    this.fs = o.fs ?? nodeCursorDiscoveryFs;
    this.rolloutFs = o.rolloutFs ?? nodeRolloutFs;
  }

  async scan(isKnown: (sessionId: string) => boolean): Promise<CursorFoundSession[]> {
    const now = this.o.clock.now();
    const cutoff = now - this.o.lookbackDays * DAY_MS;
    const byFolder = await this.candidates(cutoff, isKnown);
    const found: CursorFoundSession[] = [];
    for (const group of byFolder) {
      for (const root of this.roots(group)) {
        const sessionId = cursorSessionId(root.chat.chatId);
        const first = this.firstSeen.get(root.chat.path) ?? now;
        this.firstSeen.set(root.chat.path, first);
        // A subagent's transcript may appear before its parent's task is read: give it a moment.
        if (!isKnown(sessionId) && root.chat.digest.firstPrompt && now - first < CLAIM_GRACE_MS) {
          continue;
        }
        const meta = await this.metaOf(root.chat.chatId);
        if (!meta) continue;
        const files = [root.chat, ...root.children];
        found.push({
          sessionId,
          path: root.chat.path,
          mtimeMs: Math.max(...files.map((f) => f.mtimeMs)),
          size: files.reduce((n, f) => n + f.size, 0),
          chatId: root.chat.chatId,
          meta,
          children: root.children.map((c) => ({
            path: c.path,
            chatId: c.chatId,
            parentChatId: c.parentChatId,
          })),
        });
      }
    }
    return found;
  }

  /** The transcripts of every folder, kept to the recent ones and the ones already read. */
  private async candidates(
    cutoff: number,
    isKnown: (sessionId: string) => boolean,
  ): Promise<Candidate[][]> {
    const projects = join(this.o.cursorHome, "projects");
    const out: Candidate[][] = [];
    for (const folder of await this.list(projects)) {
      if (!isDir(folder) || folder.name.startsWith(".")) continue;
      const base = join(projects, folder.name, "agent-transcripts");
      const group: Candidate[] = [];
      for (const chat of await this.list(base)) {
        if (!isDir(chat)) continue;
        const dir = join(base, chat.name);
        const main = await this.candidate(join(dir, `${chat.name}.jsonl`), chat.name, cutoff, isKnown);
        if (main) group.push(main);
        for (const sub of await this.subagentFiles(dir)) {
          const c = await this.candidate(sub.path, sub.chatId, cutoff, isKnown);
          if (c) group.push({ ...c, folderParent: chat.name });
        }
      }
      if (group.length > 0) out.push(group);
    }
    return out;
  }

  private async subagentFiles(chatDir: string): Promise<{ path: string; chatId: string }[]> {
    const dir = join(chatDir, "subagents");
    const names = await this.list(dir);
    return names
      .filter((e) => e.isFile() && !e.isSymbolicLink() && e.name.endsWith(".jsonl"))
      .map((e) => ({ path: join(dir, e.name), chatId: e.name.slice(0, -".jsonl".length) }));
  }

  private async candidate(
    path: string,
    chatId: string,
    cutoff: number,
    isKnown: (sessionId: string) => boolean,
  ): Promise<Candidate | undefined> {
    let st: Awaited<ReturnType<CursorDiscoveryFs["stat"]>>;
    try {
      st = await this.fs.stat(path);
    } catch {
      return undefined;
    }
    if (!st.isFile) return undefined;
    if (st.mtimeMs < cutoff && !isKnown(cursorSessionId(chatId))) return undefined;
    const digest = await updateDigest(this.rolloutFs, path, this.digests.get(path), this.o.onSkip);
    if (!digest) return undefined;
    this.digests.set(path, digest);
    return { chatId, path, mtimeMs: st.mtimeMs, size: st.size, digest };
  }

  /** The chats that are no one's subagent, each with all the subagents below it. */
  private roots(group: Candidate[]): { chat: Candidate; children: (Candidate & { parentChatId: string })[] }[] {
    const parentOf = new Map<string, string>();
    for (const c of group) {
      if (c.folderParent) {
        parentOf.set(c.chatId, c.folderParent);
        continue;
      }
      const prompt = c.digest.firstPrompt;
      if (!prompt) continue;
      const parent = group.find((p) => p !== c && p.digest.taskPrompts.includes(prompt));
      if (parent) parentOf.set(c.chatId, parent.chatId);
    }
    const rootOf = (id: string): string => {
      let cur = id;
      for (let i = 0; i < 16 && parentOf.has(cur); i++) cur = parentOf.get(cur) as string;
      return cur;
    };
    const roots = group.filter((c) => !parentOf.has(c.chatId));
    return roots.map((chat) => ({
      chat,
      children: group
        .filter((c) => parentOf.has(c.chatId) && rootOf(c.chatId) === chat.chatId)
        .map((c) => ({ ...c, parentChatId: parentOf.get(c.chatId) as string })),
    }));
  }

  private async list(path: string): Promise<Dirent[]> {
    try {
      return await this.fs.readdir(path);
    } catch {
      return [];
    }
  }

  /** `chats/<hash>/<chat>/meta.json`: the hash isn't known, so each is tried (and remembered). */
  private async metaOf(chatId: string): Promise<CursorChatMeta | undefined> {
    const cached = this.metas.get(chatId);
    if (cached) return cached.meta;
    const now = this.o.clock.now();
    if (now - (this.metaMisses.get(chatId) ?? -META_RETRY_MS) < META_RETRY_MS) return undefined;
    const chats = join(this.o.cursorHome, "chats");
    for (const hash of await this.list(chats)) {
      if (!isDir(hash)) continue;
      const path = join(chats, hash.name, chatId, "meta.json");
      try {
        const st = await this.fs.stat(path);
        if (!st.isFile) continue;
        const meta = parseMeta(new TextDecoder().decode(await this.rolloutFs.readFile(path)));
        if (!meta) continue;
        this.metas.set(chatId, { path, meta });
        return meta;
      } catch {
        // Not under this hash.
      }
    }
    this.metaMisses.set(chatId, now);
    return undefined;
  }
}

function parseMeta(json: string): CursorChatMeta | undefined {
  try {
    const m = JSON.parse(json) as Record<string, unknown>;
    if (typeof m.cwd !== "string" || !m.cwd) return undefined;
    return {
      cwd: m.cwd,
      createdAtMs: typeof m.createdAtMs === "number" ? m.createdAtMs : 0,
      ...(typeof m.title === "string" && m.title ? { title: m.title } : {}),
    };
  } catch {
    return undefined;
  }
}
