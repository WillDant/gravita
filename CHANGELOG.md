# Changelog

All notable changes to Gravita. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [SemVer](https://semver.org/).

## [Unreleased]

### Conversation
- **A composer that feels like a chat:** one card with the message on top and a quiet toolbar under it (model, permissions, send). Return sends, shift-return breaks the line, and ⌘↩ still works. The send button fills once there is something to send.
- **See the agent work:** a shimmering line under the conversation says what the main agent is doing now ("Main agent is editing auth.ts"), from the moment you send.
- **Your message shows right away,** before the transcript catches up.
- **Tool calls between messages** fold into one line ("Read 3 files · Ran 2 commands") that opens into the steps.
- **Copy** a message or a code block, and jump back to the latest message after scrolling up.
- Fields inside a framed control no longer draw a second focus ring.

## [0.3.0-beta] - 2026-10-14

Codex support: OpenAI's Codex alongside Claude Code, in observation, chats and squads, and budgets in plan usage for both.

### Codex
- **Your Codex sessions, live:** sessions you run in a terminal, an editor or the Codex app show up with their subagents, tools, tokens and plan usage, read-only from Codex's session files (`~/.codex/sessions`).
- **Codex chats:** choose Codex in the new-session panel. Codex streams its work, asks before acting (Ask before acting, Edit in this folder, or Full access), takes follow-ups that steer the turn in progress, and can be interrupted. Approvals and questions come to Gravita; models are Codex's own list. Chats use your own `codex` and its login.
- **Code mode understood:** Codex runs its calls inside small scripts; the map shows what each script does (the command, the files a patch edits, the MCP or web tool it calls), not the script.
- **The kill switch and the six-chat cap** count Codex chats too.

### Squad
- **Codex roles:** build with Claude Code only, Codex only, or a mix, chosen per role (Claude by default); the Board shows each role's provider and lets you change it.
- **Gravita's Codex profile:** squads run Codex in a home of Gravita's own (`~/.gravita/codex-home`), never your `~/.codex`, so they never load your MCP servers, hooks or plugins. You sign in to it once with ChatGPT, through Codex itself; Gravita never sees the token.
- **Same rules on Codex:** a role's sandbox is its worktree, every request Codex makes goes through the ownership guard and the squad's autonomy, the commit gate still decides, and Gravita's role tools reach Codex as a loopback MCP server bound to one session by a token.
- **Codex plans:** a Codex planner answers with a structured plan (`outputSchema`); the schema's length limits travel to the model in words, since strict mode can't enforce them.
- **Budgets in plan usage:** a squad's budget is a share of your plan ("use at most 20% of my weekly limit", or of the 5-hour window), measured as the change since the squad started building, per provider. It warns at 75%, pauses at 100%, and goes on with a bigger share. A window that resets mid-squad carries what was used. Other use of the same account counts, and the screens say so.
- Accounts without plan limits (an API key) keep dollar budgets; a plan share on such an account is refused with a clear error. Squads created with dollars keep working.
- **Plan usage everywhere:** Home shows each provider's 5-hour and weekly usage with its reset time (orange only when the plan is close to its limit), the new-squad panel shows the window next to the share, and a session shows plan usage, or its cost for an API key.

### Fixed
- An interrupted Codex call no longer shows as a success.
- Under Guarded, anything a Codex role asks beyond its sandbox (an escalated command, network, reads or writes outside the worktree) now comes to you instead of being accepted.
- A plan budget keeps the points a squad used across an engine restart, and a late reading at a window's reset is no longer counted as a new window.
- A Codex squad counts the plan of Gravita's Codex profile, the account its sessions run on, never your own Codex's.
- The kill switch also stops sessions that are still starting; role tools over MCP have no idle timeout.
- Codex events from the live stream and the session files no longer duplicate when items have no id (compaction, reasoning), and a subagent links to the call that spawned it and can take more turns.

### Engine protocol
- `engine.status` reports each provider under `providers`; `claude` stays as a deprecated copy of `providers.claude` for one version.
- `models.list {provider}` lists a provider's models; `claude.models` is a deprecated alias.
- Errors 4005 (`providerUnavailable`, formerly `claudeUnavailable`) and 4008 (`notLoggedIn`) have provider-neutral messages and name the provider in `error.data`.
- `session.start` takes an optional `provider` (Claude Code by default); session modes are in the provider's own terms.
- The engine takes `--codex-home` (default `~/.codex`); only its `sessions/` folder is read.
- `usage.limits` (ephemeral): a plan window's usage per provider, kept in `GravitaState.usage` and in snapshots. `budget.baseline` records where a plan squad's count starts (and restarts after a reset).
- `squad.create` takes `budget` (`{mode: "plan", maxPercent, window}` or `{mode: "usd", amount}`); `budgetUsd` stays accepted. `squad.resume` takes `maxPercent`. Budget levels carry `unit: "points"` for plan squads.
- `ProviderStatus.account.plan` (`limited` or `api`); `usage.refresh` asks for a fresh reading through a running session; error 4014 `planUsageUnavailable`.
- `session.start` with `provider: "codex"` starts a Codex chat; Codex modes are `ask`, `workspace` and `fullAccess`. `models.list {provider: "codex"}` lists Codex's own models.
- `squad.create` takes `providers` (`claude`, `codex` or `mixed`) and a plan role takes `provider`.
- `codexProfile.status`, `codexProfile.signIn` and `codexProfile.signOut` manage Gravita's Codex profile for squads; `engine.status` reports it under `providers.codex.squadProfile`.
- Events from Codex carry `source: "codex-rpc"` (a chat or squad session Gravita runs) or `"codex-rollout"` (Codex's session files), with the same keys for the same fact.

## [0.2.0-beta] - 2026-10-13

Squads: a team of role agents that builds from a goal you describe, with clear ownership, a budget and you in control.

### Squad
- **Brief as a conversation:** start a squad from a project (or an empty folder); a read-only planner looks around, asks what it needs and then writes the plan.
- **Plan you approve:** the Board shows each role, the paths it alone may change, its tasks in plain language, the checks that will run and a cost estimate. Edit, move or remove tasks, answer the planner's questions, or replan with feedback; nothing is built before you approve.
- **Parallel build without collisions:** each role works in its own git worktree; a foundation sets up the project and freezes the contracts first; Gravita commits every task through a gate that refuses changes outside the role's paths, merges into an integration branch, runs the checks and undoes a merge that turns them red.
- **Watch it as a transit map:** integration is the trunk, every role a line, every task a station; decisions that need you (a stuck task, a spent budget) come first.
- **Deliver your way:** merge into your branch, open a pull request, or leave the branch.
- **Cost-smart by default:** Automatic runs most work on Sonnet, Opus where it matters, Haiku for helpers, and steps up only when a task struggles; or pick one model everywhere. Budgets warn at 75% and stop at 100%; resume with a higher one.
- **Isolated agents:** squad agents load the repository's own settings only, never your personal MCP servers, plugins or skills.

### Fixed
- Squad sessions no longer inherit the user's whole Claude Code setup, which multiplied the cost of every call.

## [0.1.0-alpha] - 2026-10-13

The first preview: see and steer Claude Code sessions and their subagents, on macOS.

### See
- **Home, Project, Session, Agent:** every project with agents running, a "Needs you" list that names the exact subagent asking, and a live line map per session (agents are lines, tool calls are stations, subagents branch off and merge back).
- **Lenses:** Lines, Orbit (the project as a sun, agents as planets, subagents as moons, crowds as a "×N" swarm), Conversation and Tree.
- **Personas:** each agent is an orb with eyes that react to what it does, with at most a third of them in strong motion at once and full `prefers-reduced-motion` support.
- **Sessions from your terminal** show up on their own, read-only from Claude Code's transcripts and session registry.

### Steer
- **Chats in Gravita**, through the official Claude Agent SDK and your own installed, logged-in `claude`: start a session in a folder, send messages, approve or deny tools (subagents included), answer questions, interrupt, stop a subagent, switch model and permission mode.
- **Tray and kill switch:** closing the window keeps agents running; the menu-bar icon shows who is waiting and stops every session Gravita runs at once.
- **Notifications** when an agent waits on you, a chat finishes or an agent fails, opening that agent when you come back.

### Optional
- **Deep Observe**, an opt-in Claude Code plugin with observe-only hooks, so terminal sessions waiting on a permission also show in "Needs you". You install it through Claude Code's own `/plugin` flow; see [docs/deep-observe.md](docs/deep-observe.md).

### Privacy and compliance
- Local only, no telemetry, never a Claude login of its own, never reads Claude credentials, never writes under `~/.claude`. See [docs/COMPLIANCE.md](docs/COMPLIANCE.md).

### Known limits
- macOS only for now, unsigned (right-click → Open the first time).
- Clicking a notification activates Gravita; when the window was closed, open it from the Dock or the tray to land on the agent.
- English and Brazilian Portuguese.

[0.3.0-beta]: https://github.com/WillDant/gravita/releases/tag/v0.3.0-beta
[0.2.0-beta]: https://github.com/WillDant/gravita/releases/tag/v0.2.0-beta
[0.1.0-alpha]: https://github.com/WillDant/gravita/releases/tag/v0.1.0-alpha
