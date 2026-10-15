# Gravita

**See and steer every AI coding agent and subagent, across all your projects.**

When Claude Code or Codex fans out into subagents, it gets hard to tell who is doing what, how many are running, and which one is waiting for you. Gravita draws your sessions as a live transit map: each agent is a coloured line, every tool call is a station, and a subagent is a branch line that leaves its parent and merges back when it's done. The agent itself rides at the head of its line as a small orb with eyes that react to what it's doing.

> Status: **v0.8.0-beta**, a preview for macOS. Works with Claude Code, Codex and Cursor, in Gravita's own terminal or chat, and squads can mix Claude Code and Codex. Open source under Apache-2.0.

## What it does

- **Home:** every project with agents running, like a service status board, plus a "Needs you" list that says exactly which subagent of which session is asking.
- **Project:** all sessions in a repo (worktrees included), with their lines, status and token use.
- **Session:** talk on the left, the map on the right. Run your own `claude` or `codex` in a terminal inside Gravita, or chat with it (approve tools, answer questions, interrupt, switch model or mode), while the live line map, an Orbit lens (the project as a sun, agents as planets, subagents as moons) or a tree shows every agent beside it, over a plain-language "What's happening" column.
- **Squads:** describe a goal and a team of role agents (backend, frontend, tests…) builds it in parallel git worktrees. You approve the plan first; each role can only change its own paths; Gravita commits, merges and runs the checks; a budget caps the spend; you deliver by merge, pull request or branch. Each role runs on Claude Code or Codex. See [docs/squad.md](docs/squad.md).
- **Tray and notifications:** close the window and agents keep running; the menu-bar icon shows who is waiting and stops every Gravita agent at once, and the OS tells you when someone needs you.
- **Agent panel:** what the agent is doing now, what it did (Story → Steps → Raw), its subagents and the files it touched.
- **Codex:** your Codex sessions show up live, Codex chats run in Gravita, and squad roles can run on Codex. See [docs/codex.md](docs/codex.md).
- **Cursor (optional):** Cursor chats and terminals run in Gravita through the `cursor-agent` you installed, with a Cursor API key you paste into Gravita, and their sessions show up on the map. See [docs/cursor.md](docs/cursor.md).
- **Plan usage:** squad budgets are a share of your plan's 5-hour or weekly limit, for Claude and Codex alike; Home shows how much of each is used.
- Sessions you start in your own terminal show up on their own. Gravita reads Claude Code's transcripts and Codex's session files (read-only) and Claude Code's live session registry.

## Deep Observe (optional plugin)

Transcripts don't say when a terminal session is waiting on a permission dialog. The optional **Deep Observe** plugin adds observe-only hooks that tell Gravita, on 127.0.0.1, what each agent is doing as it happens, so those sessions show up in "Needs you" too. Install it in Claude Code:

```
/plugin marketplace add WillDant/gravita
/plugin install deep-observe@gravita
```

On Claude Code 2.1.275 or later: `/plugin install deep-observe --marketplace WillDant/gravita`. The hooks never block or answer anything, and never send your prompts. See [docs/deep-observe.md](docs/deep-observe.md).

Coming next: polish and a public launch. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Your account, your machine

Gravita runs the `claude` and `codex` you already installed and logged into. It never offers its own Claude login, never reads your Claude or Codex credentials, and never sends telemetry. Codex squads use a separate profile you sign in to once, through Codex itself. Cursor is the one exception: Cursor chats use a Cursor API key you paste into Gravita, kept only in your macOS Keychain and handed only to the `cursor-agent` processes Gravita starts. See [docs/COMPLIANCE.md](docs/COMPLIANCE.md).

## Develop

Requirements: Node ≥ 22, pnpm 10, Bun ≥ 1.4, and Rust (only for the desktop shell).

```bash
pnpm install
```

```bash
pnpm --filter @gravita/engine dev:demo
```

```bash
pnpm --filter @gravita/desktop dev
```

Then open http://127.0.0.1:5173. The demo engine plays scripted agents, so you don't need Claude Code or an account to work on the UI. Use `dev` instead of `dev:demo` to watch your real `~/.claude`.

Desktop app (needs Rust):

```bash
pnpm --filter @gravita/desktop tauri dev
```

Tests:

```bash
pnpm test
```

## Repository

```
apps/desktop          Tauri shell + React UI
apps/engine           Bun sidecar: ingest, SQLite event store, local WebSocket API
packages/protocol     The normalized event model (zod) and the RPC contract
packages/core         Reducer, status machine, personas, line-map model (pure TS)
packages/adapter-claude  Claude Code transcripts and hooks → events
packages/adapter-codex   Codex session files and app-server → events
packages/adapter-cursor  Cursor's cursor-agent ACP server → events
packages/adapter-fake    Scripted demo agents
plugins/deep-observe  Optional Claude Code plugin (observe-only hooks)
fixtures/             Recorded/synthetic transcripts used by tests
docs/adr/             Architecture decisions
```

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
