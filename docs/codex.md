# Codex in Gravita

Gravita works with [Codex](https://github.com/openai/codex), OpenAI's coding agent, next to Claude Code: it shows your Codex sessions live and lets you start and steer Codex chats. It uses the `codex` you installed, with your own login; Gravita never logs you in and never sees a token.

## What works

- **Your Codex sessions, live.** Sessions you run in a terminal, an editor or the Codex app appear in Gravita with their subagents, tools, tokens and plan usage, read from Codex's own session files (`~/.codex/sessions`, read-only).
- **Codex chats.** In the new-session panel, choose Codex (the choice appears when both Claude Code and Codex are installed; with only Codex, chats start on Codex). A chat streams Codex's work, asks you before acting (per the mode you pick), takes follow-up messages, and can be interrupted. A message sent while Codex is working steers the turn in progress.
- **Approvals and questions.** When Codex wants to run a command, change files or widen its sandbox, Gravita shows the request with the command or the files; Allow and Deny answer Codex. When Codex asks you a question, you answer it in Gravita.
- **Models.** The model list is Codex's own (`model/list`); changing the model applies from the next turn.
- **The kill switch** (tray, or `engine.stopAll`) stops Codex chats too, and they count toward the six chats Gravita runs at once.

Not yet: Codex roles in squads, stopping a single Codex subagent (interrupt stops the whole turn), and MCP servers' forms (declined).

## Requirements

- Codex 0.160.0 or later. Install it with `brew install --cask codex` or `npm install -g @openai/codex`.
- Logged in: run `codex login` in a terminal (ChatGPT sign-in or an API key). Gravita shows whether Codex is logged in and, when it isn't, the command to run.

## Modes

| In Gravita | What Codex may do without asking | Codex settings |
| --- | --- | --- |
| Ask before acting | Read files | read-only sandbox, approval on request |
| Edit in this folder | Edit files and run commands in the chat's folder, without network | workspace-write sandbox (the folder), approval on request |
| Full access | Anything, anywhere, without asking | no sandbox, never asks |

Full access can only be chosen when a chat starts, never switched on later, and Gravita warns before you start one. A mode or model changed during a chat applies from the next turn.

## Plan usage

On a ChatGPT plan, Codex reports how much of your 5-hour and weekly limits is used. Gravita reads it from a running chat, or else from a short-lived `codex app-server` that only reads the account (no session, nothing spent), at most once a minute. The numbers are account-wide: any use of the same account moves them. With an API key there are no plan limits.

## Compliance

See [COMPLIANCE.md](COMPLIANCE.md#codex): Gravita reads only `sessions/` in the Codex home, never `auth.json` or Codex's other files, runs your own `codex` unmodified with an allowlisted environment, and keeps only the kind of login and the plan type from your account (never your email).

## For contributors

- The app-server protocol is pinned: `packages/adapter-codex/src/app-server/protocol/` holds the types generated for Codex 0.160 (`bun tools/vendor-codex-protocol.ts` regenerates them).
- Tests never run Codex: a scripted app-server replays `fixtures/codex-rpc/0.160/*.jsonl` (synthetic, built from the generated types).
- The live stream and the session files must give the same fact the same key; `packages/adapter-codex/test/rpc-mapper.test.ts` checks it against `fixtures/codex/0.160/app-server-chat`.
