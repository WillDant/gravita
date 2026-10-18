# Changelog

All notable changes to Gravita. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [SemVer](https://semver.org/).

## [Unreleased]

### Interface
- **Files in the session:** a folder button at the top right of a chat (or ⇧⌘E) swaps the map for the project's files. Pressing a file opens it in an editor where the terminal or conversation is, with a new File option beside Terminal · Conversation (shown only while a file is open). Open files are tabs under that switch: a dot marks unsaved changes, ⌘S saves and turns it back into a close button. Closing a tab with unsaved changes asks first, and a file changed on disk since it was opened is never overwritten without asking. Folders show in blue and the main file types (TypeScript, JavaScript, JSON, styles, Markdown, Python, Rust, images, config, shell, lockfiles) each have their own coloured icon, in the tree and on the tabs.

### Known limits
- Files over 2 MB and binary files don't open in the editor.

## [0.10.0-beta] - 2026-10-16

See what the agent changed without leaving the chat: the branch, its pull request and the diff, one click away.

### Interface
- **Git in the session:** a button at the top right of a chat shows its branch and how many files changed; it (or ⇧⌘G) opens a panel with the branch and its upstream, the branch's pull request (state, checks, review) and the diff of every changed file, new files included. It only reads the repository, never writes to it.

### Known limits
- The pull request comes from the GitHub CLI (`gh`): without it, or signed out of it, the panel says so and shows the rest.
- Very large diffs are cut at 512 KB.

## [0.9.0-beta] - 2026-10-15

Terminals get their own screen: open as many as you like, split them, and see each one in the menu.

### Interface
- **New terminal:** a button right under Home opens a shell in your home folder. Opening a terminal from a project still starts it in the project's folder.
- **Terminais screen:** split any terminal to the right or below, drag the lines between them (or use the arrow keys on one) to resize, and the layout is remembered. A shell that starts an agent stays where it is.
- **Terminais in the menu:** every terminal is listed, with the terminal icon for a plain shell and the agent's own icon and name (Claude Code, Codex, Cursor Agent) while one runs in it; it goes back to Shell when the agent exits.
- **New project:** a `+` appears beside Projetos (and beside Terminais) when you hover the heading; the one for projects opens Home with the new session form ready.

### Known limits
- Gravita opens at most eight terminals at a time.
- The agent in a shell is noticed within a couple of seconds of starting it.

## [0.8.2-beta] - 2026-10-15

Icons in the forms, so the options are easier to tell apart at a glance.

### Interface
- **New squad and New session:** icons on the field captions and on the title, and on each option card of Autonomy, Models and Who builds it (Claude Code and Codex use their own marks).
- **Home and Settings:** icons on the section titles.

### Updating
- This is the first release you can install from the app: with 0.8.0-beta, Settings → Updates → "Check for updates" → "Install" downloads it, replaces Gravita and opens it again.

## [0.8.0-beta] - 2026-10-15

Gravita can now update itself: one click in Settings, and it downloads the new version, swaps itself and opens again.

### Updates
- **Install in place:** in Settings → Updates, "Install" downloads the new version with a progress count, checks its signature against a key built into the app, replaces Gravita and opens it again. Running agents stop, as on any quit, and the screen says so before you press.
- **If it can't:** a release without an update package falls back to downloading the `.dmg` and opening it; if that fails too, a button opens the release page.
- **How it looks:** the app asks one file on GitHub (`latest.json` of this repository) and downloads the package from this repository's releases; nothing about you is sent. A package whose signature doesn't verify is refused. See [COMPLIANCE](docs/COMPLIANCE.md).

### Known limits
- This is the last release you install by hand: builds before 0.8.0-beta don't know how to update in place. From here on, Settings → Updates does it.
- Builds are still signed ad hoc and not notarized, so macOS may ask once more to let Gravita read its Cursor key from the Keychain after an update.

## [0.7.2-beta] - 2026-10-15

A quieter menu: the footer keeps only what you reach for while working.

### Interface
- **Menu footer:** it now has just Settings and Notifications. The theme and language buttons are gone from it; both are set in Settings, under Preferences.

## [0.7.1-beta] - 2026-10-15

Settings can now tell you which version you run, look for a newer one and install it.

### Updates
- **A new "Updates" section in Settings:** it shows the current version and has a "Check for updates" button that looks right away (the app still looks by itself every six hours).
- **Install:** when a newer release is out, "Install" downloads its `.dmg`, checks its SHA-256 against the digest GitHub reports, and opens it; you drag Gravita to Applications. A file that doesn't match is deleted and never opened. If the download fails, or a release has no installer, a button opens the release page instead.
- **Privacy:** nothing new is sent: the download comes from this repository's own releases, and only when you press "Install". See [COMPLIANCE](docs/COMPLIANCE.md).

### Known limits
- The app still doesn't replace itself or restart: that needs signed updates, still ahead.
- Installing from the app works on macOS only. Builds before this one don't have the section.

## [0.7.0-beta] - 2026-10-15

A cleaner macOS window: the title bar is gone and the app runs up to the top edge.

### Interface
- **Transparent title bar (macOS):** the native bar is replaced by an overlay, so the window's top has the app's own colour and follows the theme; the close, minimise and zoom buttons sit over it. Drag the window by its top edge.
- **Cursor key on Home:** the line about the Cursor API key is gone from Home. The key is still set in Settings, and New session still points you there when it's missing.

## [0.6.0-beta] - 2026-10-15

Gravita now tells you, inside the app, when a newer release is out, and Settings gets the preferences that used to live only in the menu.

### New releases
- **A notice in the bottom-right corner** when a release newer than the one you run is published: "Download" opens its page in your browser, "Later" hides that version until a newer one comes out. Nothing is downloaded or installed by the app.
- **How it looks:** a few seconds after start and every six hours, the engine makes one anonymous request to GitHub's public releases list for `WillDant/gravita`; it sends only `gravita/<version>` as its user agent, and nothing about you or your projects. It is not telemetry, never runs in the demo, and fails quietly when you're offline. Only the repository's own release pages are ever opened. See [COMPLIANCE](docs/COMPLIANCE.md).

### Interface
- **Preferences in Settings:** theme (light or dark), language and the three notification switches, each with an icon. The shortcuts in the menu's footer stay.
- **The menu:** "Needs you" is gone from it (it only opened Home); Settings moved to the footer with the other controls, and Home is larger and stands out.

### Known limits
- The release check can't be turned off yet, and the app never updates itself: that needs signed updates, still ahead.
- Builds before this one don't show the notice.

## [0.5.0-beta] - 2026-10-15

Cursor as a third agent: Cursor chats and terminals run your own `cursor-agent`, with a Cursor API key you paste into Gravita, and their sessions show up on the map.

### Cursor
- **Cursor chats:** choose Cursor in the new-session panel. Gravita runs the `cursor-agent` you installed (its `acp` server, 2026.10.14 or later) in the chat's folder, with Cursor's Agent, Plan and Ask modes and your account's models ("Auto" by default). Every approval Cursor asks for waits for you; Gravita answers once at a time, never "always".
- **Cursor in the terminal:** "Run in: Terminal" opens `cursor-agent` in Gravita's terminal, with the same key, and its chats (and subagents) show up on the map beside it, read-only from the CLI's own transcripts under `~/.cursor`.
- **Your Cursor API key:** paste it in Gravita's settings. It's kept only in your macOS Keychain, handed to the engine over its stdin, and given only to the `cursor-agent` processes Gravita starts (never to other terminals, never on a command line, never over the WebSocket). It's masked in everything Gravita shows, and checked with `cursor-agent models` (valid, invalid or offline). Gravita never uses a key from your shell or a saved `cursor-agent login`. See [ADR 008](docs/adr/008-cursor-provider.md) and [docs/cursor.md](docs/cursor.md).
- Cursor is optional, like Codex: without `cursor-agent`, Claude Code and Codex work as before. Squads don't run on Cursor.

### Interface
- **An icon and a colour per project**, in the sidebar, the project's header and Home.
- **Provider and run-in icons:** Claude Code, Codex and Cursor marks, and Terminal or Chat, wherever you choose them; the Cursor key shows green when valid, red when not.
- **A chat opens empty:** the new-session panel no longer asks for a first message; you write it in the composer.
- **Removing a session asks first.** The confirmation dims the screen behind it.

### Known limits
- Cursor reports no token use or cost, can't be steered mid-turn, stops only its main agent, and its own questions are declined.
- A Cursor chat's conversation shows while the chat runs; once it ends, its map stays but the text doesn't.
- The app also lists older `cursor-agent` chats that have a `meta.json`, within the 14-day history window.
- Builds are signed ad hoc, so macOS may ask once more for Gravita to read its Keychain item after an update.

## [0.4.0-beta] - 2026-10-14

Terminal and conversation: run Claude Code or Codex in a terminal inside Gravita with the map beside it, and a conversation that shows the agent at work.

### Conversation
- **A composer that feels like a chat:** one card with the message on top and a quiet toolbar under it (model, permissions, send). Return sends, shift-return breaks the line, and ⌘↩ still works. The send button fills once there is something to send.
- **See the agent work:** a shimmering line under the conversation says what the main agent is doing now ("Main agent is editing auth.ts"), from the moment you send.
- **Your message shows right away,** before the transcript catches up.
- **Tool calls between messages** fold into one line ("Read 3 files · Ran 2 commands") that opens into the steps.
- **Copy** a message or a code block, and jump back to the latest message after scrolling up.
- Fields inside a framed control no longer draw a second focus ring.

### Terminal and map, side by side
- **Start a session in a terminal:** the new-session panel now asks where to run it, and Terminal is the default. Your own `claude` or `codex` opens in an embedded terminal in the project's folder, with the model and permissions you picked and your first message, which is optional there.
- **Talk on the left, the map on the right:** a session's screen shows its terminal (or its conversation) beside a resizable map column, with Lines, Orbit or Tree over "What's happening" or the agent panel. A switch in the header shows both, talk alone, or the map alone (the classic view). Hiding a side keeps its terminal running and on screen when it comes back.
- **Open a terminal** in any project (your shell). Whatever Claude Code or Codex session you start in it shows up on the map beside it.
- **Continue in a terminal:** an observed session that no longer runs can be resumed in a terminal here. A terminal whose process ended offers to resume its session or start again.
- The conversation is no longer one of the lenses: it's the talk side of the screen.

### Terminals (engine)
- **A terminal in the engine:** `terminal.spawn` opens your login shell, or your own `claude` or `codex`, in a pseudo-terminal in a project's folder. Output streams to the app as it's printed, and the newest 1 MB stays available when the app reconnects. A Claude Code terminal is linked to its session from the start. A Codex or shell terminal is linked to the first session that starts in it. See [ADR 007](docs/adr/007-embedded-terminal.md).

### Fixed
- A session resumed after it stopped (`claude --resume`, in Gravita or in your own terminal) no longer shows its main agent as "lost its session".

### Tested for real
- A Claude Code session started in Gravita's terminal: the map, the title and the conversation filled in from the start, a subagent branched off and merged back live, closing the terminal ended the process, and "Continue in a terminal" resumed it with its history.

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

[0.10.0-beta]: https://github.com/WillDant/gravita/releases/tag/v0.10.0-beta
[0.9.0-beta]: https://github.com/WillDant/gravita/releases/tag/v0.9.0-beta
[0.8.2-beta]: https://github.com/WillDant/gravita/releases/tag/v0.8.2-beta
[0.8.0-beta]: https://github.com/WillDant/gravita/releases/tag/v0.8.0-beta
[0.7.2-beta]: https://github.com/WillDant/gravita/releases/tag/v0.7.2-beta
[0.7.1-beta]: https://github.com/WillDant/gravita/releases/tag/v0.7.1-beta
[0.7.0-beta]: https://github.com/WillDant/gravita/releases/tag/v0.7.0-beta
[0.6.0-beta]: https://github.com/WillDant/gravita/releases/tag/v0.6.0-beta
[0.5.0-beta]: https://github.com/WillDant/gravita/releases/tag/v0.5.0-beta
[0.4.0-beta]: https://github.com/WillDant/gravita/releases/tag/v0.4.0-beta
[0.3.0-beta]: https://github.com/WillDant/gravita/releases/tag/v0.3.0-beta
[0.2.0-beta]: https://github.com/WillDant/gravita/releases/tag/v0.2.0-beta
[0.1.0-alpha]: https://github.com/WillDant/gravita/releases/tag/v0.1.0-alpha
