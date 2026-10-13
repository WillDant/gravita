# Gravita

**See and steer every AI coding agent and subagent, across all your projects.**

When Claude Code fans out into subagents, it gets hard to tell who is doing what, how many are running, and which one is waiting for you. Gravita draws your sessions as a live transit map: each agent is a coloured line, every tool call is a station, and a subagent is a branch line that leaves its parent and merges back when it's done. The agent itself rides at the head of its line as a small orb with eyes that react to what it's doing.

> Status: early development (milestone M0). Works with Claude Code today; Codex is next. Open source under Apache-2.0.

## What it does

- **Home:** every project with agents running, like a service status board, plus a "Needs you" list that says exactly which subagent of which session is asking.
- **Project:** all sessions in a repo (worktrees included), with their lines, status and token use.
- **Session:** the live line map, a plain-language "What's happening" column, and a tree lens.
- **Agent panel:** what the agent is doing now, what it did (Story → Steps → Raw), its subagents and the files it touched.
- Sessions you start in your own terminal show up on their own. Gravita reads Claude Code's transcripts (read-only) and its live session registry.

Coming next: starting chats from Gravita with an approvals inbox (M1), and **Squads**: a planner, backend, frontend, design and tests team working in parallel worktrees with shared context and enforced file ownership (M2).

## Your account, your machine

Gravita runs the `claude` you already installed and logged into. It never offers its own Claude login, never reads your credentials, and never sends telemetry. See [docs/COMPLIANCE.md](docs/COMPLIANCE.md).

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
packages/adapter-claude  Claude Code transcripts → events
packages/adapter-fake    Scripted demo agents
fixtures/             Recorded/synthetic transcripts used by tests
docs/adr/             Architecture decisions
```

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
