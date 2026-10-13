# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(Desktop app: a Tauri 2 shell around a web UI. The design language is web, not native iOS/Android.)

## Stack

Confirmed in the approved plan (`/Users/willdant/.claude/plans/tenho-uma-dor-hoje-twinkling-aho.md`):

- Tauri 2 desktop shell (minimal Rust: window, tray, notifications, sidecar lifecycle).
- UI: React 19 + Vite + TypeScript, shadcn/ui (Radix + Tailwind v4), Motion for UI chrome, Canvas2D for the orbit scene, SVG for single orbs.
- Engine: TypeScript sidecar (Bun-compiled) using the Claude Agent SDK, SQLite event store, JSON-RPC over a localhost WebSocket.
- Monorepo: pnpm + turborepo.
- The UI also runs in a plain browser (`pnpm dev`) against the engine or recorded fixtures.

## Users

- **Primary: developers who run several AI coding agents at once.** They use Claude Code every day (Codex next), often with background subagents, across several repos, and lose track of what each agent and subagent is doing, how many are running, and which one is waiting for them. When priorities conflict, this user wins: density, keyboard shortcuts and precise detail are designed for them.
- **Secondary: less technical builders** (product, design, founders) who direct a team of agents. They're served through progressive disclosure: a plain-language story first, steps next, raw data on demand.

## Product Purpose

Gravita makes multi-agent coding work visible and directable. It shows, live, every agent and subagent across all projects and sessions — including sessions started in the terminal or IDE — and lets a person start a role-based team of agents (planner, backend, frontend, design, tests) on a project with shared context and no overlapping work.

Success: at any moment the user can answer "what is each agent doing, how many are running, and who needs me?" in a glance, and can run a team of agents on a project without them stepping on each other.

## Positioning

- Orchestrators (Conductor, Warp, superset.sh, Orca, Emdash) treat each agent as one terminal or worktree, so subagents are invisible. Visualizers (Pixel Agents, agent-flow, claude-view) show subagent trees but are read-only, single-session and don't orchestrate. Gravita does both: a live, cross-session, cross-repo view of every subagent **and** orchestration of a role-based squad.
- Shared context between agents is a first-class, visible thing (brief, plan, contracts, notes, change requests), and non-overlap is enforced (path ownership, commit gate), not just suggested.
- Agents are personified (orbs with eyes) so the state of the work is legible without reading logs.
- Open source, local-first, and it runs the user's own Claude Code with the user's own login.

## Operating Context

- Runs on the developer's machine next to the terminal and IDE. Sessions can be started inside Gravita or anywhere else; Gravita observes both.
- Work is long-running and parallel: background subagents, several sessions per repo, several repos per day.
- Interruptions matter: agents ask for permission or input, and the user needs to know who is asking and from where.
- Usage is consumed from the user's own Claude subscription or API key (later: ChatGPT plan via Codex), so cost and limits must be visible.

## Capabilities and Constraints

**Vocabulary** (UI terms, English default / pt-BR):
- Project / Projeto — a git repository (worktrees of the same repo are one project).
- Session / Sessão — a unit of work in a project. Three kinds: Chat (talk to one main agent), Squad (a team of role agents), External (started outside Gravita; observed).
- Agent / Agente — the main agent of a chat or a squad role. Drawn as a planet.
- Subagent / Subagente — a helper an agent spawns. Drawn as a moon; can nest.

**Navigation:** Home → Project → Session → Agent (agent opens as a side panel over the session).

**Capabilities (MVP):** live observation of Claude Code sessions and subagent trees (Gravita-launched and external); chat sessions via the Agent SDK with an approvals inbox; Squad orchestration (brief → plan approval → contract-first foundation → parallel build in worktrees → verify → review/deliver); budgets and a global kill switch. Codex support comes in the next milestone.

**Constraints:**
- Anthropic does not allow third-party "Sign in with Claude". Gravita never offers Claude login, never reads or stores Claude credentials, and never bundles or modifies Claude Code; it runs the user's installed `claude`, and the user logs in through Claude Code itself. OpenAI "Sign in with ChatGPT" is allowed and is planned for the Codex milestone.
- Interface language: English by default, pt-BR as a full translation (system-detected).
- No telemetry by default.
- Lightweight is a requirement: installer ≤ 50 MB, idle RAM ≤ 250 MB, idle CPU < 2%, cold start to Home < 2 s.

**Undecided:** pricing or any hosted offering (none planned; the project is open source, license planned as Apache-2.0).

## Brand Commitments

- Name: **Gravita**. Metaphor: the project is the center of gravity; agents orbit it as planets, subagents as moons.
- Persona: hybrid **orbs with eyes** — abstract colored shapes with expressive eyes that react to what the agent is doing.
- Typography: **DM Sans** (binding).
- Look: **modern and light**, colorful through the agents (binding direction from the user; the visual world itself is defined later in DESIGN.md).
- References the user named: **21st.dev** (components) and **Awwwards** (direction and motion).
- Marketing says "works with Claude Code"; no Anthropic name or logo in the product name or brand.

## Evidence on Hand

None yet: no users, testimonials, metrics, screenshots or press. Competitor research exists only in the planning conversation. Future work must not invent customers, usage numbers, quotes or benchmarks.

## Product Principles

1. **Nothing runs invisibly.** Every agent and subagent is always findable, named, and counted the same way on every screen.
2. **Plain language first, raw on demand.** Story → Steps → Raw; the developer is one keystroke from the raw data.
3. **The user's account, the user's machine.** Local-first; never touch credentials; the user approves what costs money or touches code.
4. **Light by default.** Performance and footprint budgets are product features, not afterthoughts.
5. **Safe parallelism.** Teams of agents get clear ownership, shared context and budgets so parallel work never collides.

## Accessibility & Inclusion

- Respect `prefers-reduced-motion`: orbs fall back to static poses with glyph and label.
- Agent state is never conveyed by color alone (shape, glyph and text label too).
- The orbit scene has a keyboard- and screen-reader-accessible overlay listing every agent and its status.
