# Changelog

All notable changes to Gravita. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [SemVer](https://semver.org/).

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

[0.2.0-beta]: https://github.com/WillDant/gravita/releases/tag/v0.2.0-beta
[0.1.0-alpha]: https://github.com/WillDant/gravita/releases/tag/v0.1.0-alpha
