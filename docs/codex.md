# Codex in Gravita

Gravita works with [Codex](https://github.com/openai/codex), OpenAI's coding agent, next to Claude Code: it shows your Codex sessions live, lets you start and steer Codex chats, and runs Codex roles in squads. It uses the `codex` you installed. Chats use your own login; squads use a profile of Gravita's own that you sign in to once, through Codex itself. Gravita never sees a token.

## What works

- **Your Codex sessions, live.** Sessions you run in a terminal, an editor or the Codex app appear in Gravita with their subagents, tools, tokens and plan usage, read from Codex's own session files (`~/.codex/sessions`, read-only).
- **Codex chats.** In the new-session panel, choose Codex (the choice appears when both Claude Code and Codex are installed; with only Codex, chats start on Codex). A chat streams Codex's work, asks you before acting (per the mode you pick), takes follow-up messages, and can be interrupted. A message sent while Codex is working steers the turn in progress.
- **Approvals and questions.** When Codex wants to run a command, change files or widen its sandbox, Gravita shows the request with the command or the files; Allow and Deny answer Codex. When Codex asks you a question, you answer it in Gravita.
- **Models.** The model list is Codex's own (`model/list`); changing the model applies from the next turn.
- **The kill switch** (tray, or `engine.stopAll`) stops Codex chats too, and they count toward the six chats Gravita runs at once.
- **Code mode.** Codex 0.160 runs most calls inside a small JavaScript script (its `exec` tool calling `tools.exec_command`, `tools.apply_patch`, MCP tools and `tools.web__run`). Gravita reads the script's tool calls, literal strings only, so the map shows the command, the files a patch edits, or the MCP or web tool, with "(+N)" when the script makes more calls. A script whose command is built at run time shows its first line.

- **Codex roles in squads.** A squad can be built by Claude Code only, Codex only, or a mix (see [Squads › Codex roles](squad.md#codex-roles)).

Not yet: stopping a single Codex subagent (interrupt stops the whole turn), and MCP servers' forms (declined).

## Tested

With Codex 0.160.0 on a ChatGPT Team plan (2026-10-13):
- A Codex chat (gpt-6-luna, Ask before acting): one approval answered in Gravita, and an interrupt during a 30-second command, which ended the turn 0.3 s later.
- A mixed squad on an empty folder (a pnpm todo app): the backend on Codex, the frontend and tests on Claude Code. Four tasks done on the first attempt, every check green, no ownership violation, in under six minutes, using 3 points of Codex's 5-hour window and less than 1 of Claude's, under a 10% cap.
- A Codex-only plan: the briefing and the planner on Codex, through `outputSchema`.

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

## Squads: Gravita's Codex profile

Squad agents run unattended, so they must not inherit your personal setup (your MCP servers, hooks, plugins, apps, memories). Codex reads all of that from its home folder, so squads run Codex with `CODEX_HOME` set to a home of Gravita's own, `~/.gravita/codex-home` (owner-only), never your `~/.codex`:

- **What Gravita writes there:** only `config.toml`, its own minimal one (everything else in the folder is Codex's own: the login it stores, the squads' rollouts, its databases): hooks, apps, plugins, memories, browser and computer use, image generation and tool suggestions off; no MCP servers; `GRAVITA_*` variables kept out of the agent's commands; analytics off. It is rewritten before each squad session. No project is trusted there, so a repository's `.codex/` settings aren't loaded (its `AGENTS.md` is).
- **Signing in, once:** "Sign in to Codex for squads" (the new-squad panel) starts `codex app-server` on that home and calls `account/login/start {type: "chatgpt"}`. Codex answers with a link to OpenAI's sign-in page, which Gravita opens in your browser (only an `https` link on `openai.com` or `chatgpt.com`, checked by the engine and again by the desktop shell). Codex takes the browser's callback on localhost and stores the login in that home; its `account/login/completed` notification tells Gravita it worked, and Gravita keeps only the kind of login and the plan type. Sign out goes through Codex too (`account/logout`).
- **Each squad session** is its own `codex app-server`, in the role's worktree, with that home, your allowlisted environment minus anything that would pick another home or login (`CODEX_*`, `OPENAI_API_KEY`), and Gravita's role tools added for that process only (see below).

**Sandbox and approvals.** A role's sandbox is `workspaceWrite` with the role's worktree as its only writable root (plus Codex's temp folders); network only when the squad is Autonomous. Its approval policy follows the squad's autonomy: `untrusted` for Ask (every edit and every command that isn't a known read-only one comes to Gravita), `on-request` for Guarded (only what needs more than the sandbox), `never` for Autonomous. Every request Codex makes goes through Gravita's ownership guard first (an edit outside the role's paths, or git that changes the repository, is declined and the agent is told why with a steer; for a permissions request, every path it asks to write, in its `write` list or its `entries`), then through the autonomy. Under Guarded every escalation (a command that wants out of the sandbox, even a local one or a read) and every permissions request (the network, reads or writes beyond the worktree) waits for you; allowing one grants all it asked for, for that turn only, and denying it grants nothing. The briefing of a Codex-only squad is read-only and its requests are refused (its questions still reach you); the planner is read-only and never asks.

**Role tools over loopback MCP.** Claude Code gets Gravita's role tools as an in-process MCP server; Codex can't, so the engine serves the same tools as an MCP server over HTTP on its own loopback port, `http://127.0.0.1:<port>/mcp`. Each squad session mounts its tool set (bound to its squad, role, task and attempt) under a random 256-bit token; the app-server reads the token from its environment (`-c mcp_servers.gravita.bearer_token_env_var="GRAVITA_MCP_TOKEN"`, so it never appears on a command line) and sends it as a Bearer header. A request without a known token is refused (401), and so is any request with an `Origin` header (403), so a web page can't reach it; the token dies with the session. The server is required (the session doesn't start without it) and its tools are pre-approved (`default_tools_approval_mode="approve"`), as Claude Code's role tools are always allowed.

**Structured plan.** In a Codex-only squad the planner answers through `outputSchema` on `turn/start`: the SquadPlan schema in the strict form OpenAI's structured outputs take (every object closed, optional fields as nullable). Strict mode refuses length limits, so they move into each field's description ("At most 200 characters."). Gravita reads the final message as JSON, drops the nulls and checks it like any plan.

**Conversations.** A squad's Codex sessions write their rollouts in Gravita's Codex home; the Conversation lens reads them there when a thread isn't in your `~/.codex`.

**Not yet on Codex roles:** a per-session dollar cap and a turn limit (Codex has neither; the squad's plan share bounds them), and bounds on Codex's own subagents (Claude Code roles get at most four at once, two levels deep). Package installs that write outside the worktree (a global package store) fail in the sandbox; under Guarded Codex asks to go beyond it and the request comes to you.

**Models.** Codex's tiers are your account's default model (`model/list`'s `isDefault`) at low, medium and high reasoning effort; an effort the model doesn't list becomes the nearest one it does. Codex's catalog names its models without saying which is cheaper or stronger, and effort is the knob Codex documents for cost against quality, so the policy climbs effort.

## Plan usage

On a ChatGPT plan, Codex reports how much of your 5-hour and weekly limits is used. Gravita reads it from a running chat, or else from a short-lived `codex app-server` that only reads the account (no session, nothing spent), at most once a minute. The numbers are account-wide: any use of the same account moves them. With an API key there are no plan limits.

Squads read plan usage from their own Codex sessions (`account/rateLimits/updated`, and `account/rateLimits/read` through a running one). Gravita's Codex profile is a separate login to the same ChatGPT account, so its windows are the same ones your own Codex moves.

## Compliance

See [COMPLIANCE.md](COMPLIANCE.md#codex): Gravita reads only `sessions/` in your Codex home, never `auth.json` or Codex's other files, runs your own `codex` unmodified with an allowlisted environment, and keeps only the kind of login and the plan type from your account (never your email). For squads it writes only `config.toml` in its own Codex home and never touches your `~/.codex`.

## For contributors

- The app-server protocol is pinned: `packages/adapter-codex/src/app-server/protocol/` holds the types generated for Codex 0.160 (`bun tools/vendor-codex-protocol.ts` regenerates them).
- Tests never run Codex: a scripted app-server replays `fixtures/codex-rpc/0.160/*.jsonl` (synthetic, built from the generated types), and squads run against fake app-servers whose agents call the role tools over the real loopback MCP route (`apps/engine/test/codex-squad-fakes.ts`).
- The live stream and the session files must give the same fact the same key; `packages/adapter-codex/test/rpc-mapper.test.ts` checks it against `fixtures/codex/0.160/app-server-chat`.
