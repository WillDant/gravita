---
version: 1
slug: "apps-desktop-src-app-tsx"
primary_target: "apps/desktop/src/App.tsx"
related_targets: []
---

# Surface brief: Gravita app shell (desktop)

**Mode:** Operate. Primary user: developers running several agents at once; secondary: less technical builders via Story → Steps → Raw.

**Scope:** the whole app shell and its four levels — Home → Project → Session → Agent panel — plus the Squad board and first-run "Connect Claude Code". Navigation, vocabulary and states follow the approved plan (`/Users/willdant/.claude/plans/tenho-uma-dor-hoje-twinkling-aho.md`, "Navegação").

**Job:** at a glance answer "what is each agent doing, how many are running, who needs me?" and act on it (approve, stop, open).

**Content ranges:** 1–40 projects; 0–12 live sessions; 1–6 agents per session; 0–20 subagents per agent, nesting up to depth 3; tool calls from 0 to thousands per session.

**Key states:** first run (no Claude Code / not logged in / indexing), empty project, live, waiting for you, error, detached (terminal closed), done, budget stop.

**Constraints:** DM Sans (pinned), DM Mono for numbers; light theme default, dark follows system; colorful through agents; lightweight (no WebGL, no heavy editors); `prefers-reduced-motion`; state never by color alone; English default + pt-BR.

**Unresolved:** exact role colors' contrast in dark theme; Squad board density.

**Deferred to M1 (cited, per the approved plan's milestones):**
- Orbit lens (Canvas2D orbit scene): the M0 lens tabs are Lines · Tree.
- Composer under the map: lands with the Agent SDK chat runner. External (terminal) sessions never get one; they show the "watching your terminal" bar.
- Answering permission prompts of external sessions: their prompt lives in the user's terminal, so Gravita points there instead of offering Allow/Deny. Sessions Gravita controls (demo now, SDK chats in M1) get inline Allow/Deny.

## Direction contract

THESIS: Parallel agent work reads like a transit map. Each agent is a colored line running left to right through time; tool calls are stations; handoffs and notes are interchanges; a subagent is a branch line that leaves its parent at a station and merges back when done. Refuses the category default: terminal tabs, log feeds and the gray card grid.

OWN-WORLD: White ground, cool gray second neutral for the sidebar and panels, near-black ink. Agent lines in saturated role colors (planner lilac, backend blue, frontend coral, design yellow, tests green; subagent types get their own fixed hues) at 5px with round caps and 45° bends; stations are white dots with an ink ring; interchanges are linked white capsules; line badges are colored discs with a short code. DM Sans set like transit signage: short, bold, tight 1.125 scale; DM Mono tabular numerals. The agent persona (orb with eyes) rides at the head of its line as the train.

STORY: The developer sees how many lines are running, where each agent is right now, and which line is held at a "waiting for you" station; they approve inline or click the orb to open the agent panel.

FIRST VIEWPORT: Session screen at 1440: left sidebar (Home, Needs you, Projects tree with live counts); top bar with breadcrumb, lens tabs (Lines · Orbit · Tree) and status chips (running · subagents · waiting). Center: the line map, one lane per agent, main on top, branch lines curving down from their spawn station and merging back; live orbs at the line heads; a "now" rule at the right edge. Right column: "What's happening", one plain-language row per active agent with its line badge and inline Approve/Deny on waiting rows. Composer docked under the map.

FORM: Modernist transit line diagram (metro map), #1 on the ordered list; seed key 4da55c86; chosen as Impeccable's pick. Signature move: the live line map — lines extend in real time, a spawn draws a branch curve out of the parent's current station with the new orb popping out, completion draws the merge back and the orb closes its eyes in a smile.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
