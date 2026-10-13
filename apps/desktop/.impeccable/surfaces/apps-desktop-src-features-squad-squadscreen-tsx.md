---
version: 1
slug: "apps-desktop-src-features-squad-squadscreen-tsx"
primary_target: "apps/desktop/src/features/squad/SquadScreen.tsx"
related_targets: ["apps/desktop/src/features/project/Project.tsx"]
---

# Surface brief: Squad (desktop)

**Mode:** Operate. Primary user: a developer who already uses Gravita and hands a goal to a team of role agents; secondary: a less technical builder who follows the same path reading only plain language.

**Scope:** everything a squad needs, inside the existing app shell: the "New squad" inline panel on the Project header; the Squad screen at `#/p/:pid/q/:squadId` with its phases — Brief (a conversation with the read-only planner), Board (review, light edits, approve or replan with feedback), Run (the squad's line map, phase ring, budget, role and task detail, decisions in Needs you, notes and change requests) and Deliver (summary, diff by role, final checks; merge into my branch, open a PR, or leave the branch). Chats and other sessions are untouched.

**Job:** go from a goal to a delivered branch knowing at every moment which role does what, what it has spent, and who needs you; trust that roles can't overwrite each other.

**Content ranges:** 1–6 roles; 3–40 tasks; 0–30 notes and change requests; budgets $1–$1,000; plans with 0–8 open questions; runs from minutes to an hour.

**Key states:** brief conversation (empty, planner thinking, planner asking); plan proposed, invalid plan (issues pinned to cards), planner failed after 3 tries; foundation, build, verify, deliver, done; blocked task, ownership violation, merge conflict (3-way view), red check, budget 75% and 100%, paused ("Gravita restarted", kill switch, budget), stopped; `gh` unavailable; dirty repository.

**Constraints:** Lines Carry the Colour, Orange Means You, Ink Ring, Octolinear, Signage and Tabular Numbers rules from DESIGN.md; squad screens are lazy chunks (main bundle ≤ 250 KB gzip); en + pt-BR; state never by colour alone; reduced motion.

**Unresolved:** none blocking; Board density for 6 roles × 40 tasks to be judged on the render.

## Direction contract

THESIS: A squad is a transit system with one trunk. Integration is the trunk line; every role is a coloured line running beside it, each task a station, each merge an interchange back into the trunk. It refuses the category default of a kanban board as the main view and a generic progress bar for phases.

OWN-WORLD: The Live Metro Diagram as built: white ground, cool panel chrome, hairlines, near-black ink; role lines in their fixed hues (planner indigo, backend blue, frontend coral, design mustard, tests green) at 5px with 45° knees; white ink-ringed stations and linked interchange capsules; line-code discs; DM Sans signage, DM Mono for paths, argv and costs; orange only for what waits on the user.

STORY: The user states a goal and talks it through with the planner, sees the team, who owns which paths and what it should cost, adjusts and approves; then watches lines grow and merge into the trunk, steps in only when something waits on them, and delivers in one deliberate click.

FIRST VIEWPORT: Run phase at 1440: header with breadcrumb, a compact octolinear phase ring (Brief · Plan · Foundation · Build · Verify · Deliver, current stop ringed), the budget meter (spent / total, tabular) and Pause/Stop on the right. Centre: the squad map, trunk across the top, role lines below with orbs riding their heads and signage under them. Right 340px column: per-role "What's happening", squad decisions waiting on the user at the top, then notes and change requests. Primary action: whatever waits on the user, inline in the column.

FORM: Composition authority is the user's shape round (2026-10-13), quoted verbatim, in place of a concept roll: Brief — "Conversa de briefing"; Board — "Ajustes + replanejar (Recommended)"; Run main view — "Mapa de linhas do time (Recommended)" (option 1 of 2, over "Quadro de tarefas"); the written brief was then approved as "Aprovado, pode construir (Recommended)". Seed key: none (user-locked composition).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
