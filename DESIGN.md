---
name: Gravita
description: A live transit map of parallel coding agents. Each agent is a coloured line, each tool call a station.
colors:
  ground: "#ffffff"
  panel: "#f5f6f8"
  panel-2: "#eceef2"
  hairline: "#e3e6eb"
  hairline-strong: "#cfd3da"
  ink: "#121417"
  ink-2: "#4a505c"
  ink-3: "#646b78"
  focus: "#2f5bea"
  select: "#2f5bea1f"
  waiting: "#e8590c"
  waiting-ink: "#b8430a"
  waiting-bg: "#fff1e8"
  error: "#d92d20"
  error-ink: "#b42318"
  error-bg: "#fef0ee"
  ok: "#12a15f"
  ok-ink: "#0e7a48"
  line-main: "#5b47f0"
  line-explore: "#0e9f9a"
  line-plan: "#f0552f"
  line-general: "#2f7df6"
  line-design: "#c98a00"
  line-tests: "#12a15f"
  line-rose: "#e0457b"
  line-sky: "#1c8ad9"
  line-orchid: "#b547d6"
typography:
  display:
    fontFamily: "DM Sans Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1.33
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "DM Sans Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.45
  title:
    fontFamily: "DM Sans Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.43
  body:
    fontFamily: "DM Sans Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.45
  body-sm:
    fontFamily: "DM Sans Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.43
  label:
    fontFamily: "DM Sans Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.33
  map-name:
    fontFamily: "DM Sans Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
  map-signage:
    fontFamily: "DM Sans Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
  count:
    fontFamily: "DM Sans Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 700
    fontFeature: "\"tnum\" 1"
  mono:
    fontFamily: "DM Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    letterSpacing: "-0.01em"
    fontFeature: "\"tnum\" 1"
rounded:
  xs: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  full: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"
  "10": "40px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    typography: "{typography.title}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "color-mix(in srgb, #121417 85%, transparent)"
  button-secondary:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "32px"
  button-secondary-hover:
    backgroundColor: "{colors.panel}"
  button-ghost:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "32px"
  button-ghost-hover:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
  chip-live:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "0 10px"
    height: "24px"
  chip-quiet:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "0 10px"
    height: "24px"
  chip-waiting:
    backgroundColor: "{colors.waiting-bg}"
    textColor: "{colors.waiting-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "0 10px"
    height: "24px"
  nav-item:
    textColor: "{colors.ink-2}"
    typography: "{typography.title}"
    rounded: "{rounded.md}"
    padding: "0 8px"
    height: "32px"
  nav-item-hover:
    backgroundColor: "{colors.panel-2}"
    textColor: "{colors.ink}"
  nav-item-active:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
  lens-tab:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "28px"
  lens-tab-selected:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
  line-badge:
    textColor: "{colors.ground}"
    rounded: "{rounded.full}"
    size: "18px"
  waiting-card:
    backgroundColor: "{colors.waiting-bg}"
    rounded: "{rounded.xl}"
    padding: "12px 16px"
  squad-decision-row:
    backgroundColor: "{colors.waiting-bg}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "12px 16px"
  role-strip:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    width: "300px"
---

# Design System: Gravita

## Overview

**Creative North Star: "The Live Metro Diagram"**

Gravita draws parallel agent work as a modernist transit map. Each agent is a coloured line running left to right through time; tool calls are stations; a subagent is a branch that leaves its parent at an interchange, drops on a 45° knee into its own lane, and merges back when done. The agent itself rides at the head of its line as a small persona, an orb with eyes, and a line of plain-language signage under it says what that agent is doing right now. The map is the product; every other surface is quiet so the lines can carry the meaning.

The ground is white (dark: near-black), the chrome is a cool gray panel with hairlines, and the ink is near-black. Saturated colour enters only through the agents (lines, line badges, orbs) and through three reserved state hues: orange for "waiting for you", red for error, green for running. Type is DM Sans set like transit signage: short, sentence case, semibold to bold, on a tight ~1.125 product scale; numbers are tabular, and DM Mono carries commands, paths and raw payloads. Density is that of an operating tool (14px body, 32px controls), not a marketing page.

Motion has two registers. Chrome is short and settled: a single signature ease (cubic-bezier(0.2, 0, 0, 1)) with no overshoot. The orbs are the one playful thing in the world: they breathe, bob while working, pop in with overshoot when spawned, bounce when they need you, and wobble on error. Every loop sits behind `prefers-reduced-motion`.

**Key Characteristics:**
- Transit-map signature: 5px lines, round caps, octolinear routing with 45° chamfered knees, white stations with ink rings, white interchange capsules, line-code badges.
- Squads are the same map at team scale: integration is an ink trunk across the top, each role a line in its hue below it, each task a station, each merge a spur rising back into the trunk.
- Quiet neutral chrome; colour belongs to agents and to three reserved state hues.
- Signage typography: DM Sans, sentence case, 600-700 weight for names and labels, tabular numerals.
- Flat surfaces separated by hairlines; a soft lift only marks the selected item.
- Playful persona motion on orbs only; chrome motion is brief and non-bouncy.
- Light theme default, full dark theme by token swap; state is never carried by colour alone (dot plus word, ring plus label).

## Colors

A cool, near-colourless frame around a set of saturated metro-line hues, with orange reserved to mean "you are needed".

### Primary
- **Signal Ink** (ink): the one strong neutral. Body text, ink rings on stations, orbs and interchanges, the primary button and the "running" count chip. On squads it is also the integration trunk (the one line drawn in ink, with an ink line-code disc), the phase track's travelled stretch and passed stops, and the budget meter's fill. In dark theme it inverts to a pale gray (#eceef2).

### Secondary
- **Hold Orange** (waiting / waiting-ink / waiting-bg): the "waiting for you" state and nothing else. Waiting station rings, the orb's pulsing halo, the Needs-you count, the waiting card on Home, held-line signage ("waiting for you · Bash"). On squads: blocked task stations, squad decision rows, the Run column's "needs you" band, planner questions on the Board, and a pause that waits on the user (budget, restart, kill switch); a pause the user chose stays panel gray, and the budget meter turns orange only once the budget has actually stopped the squad. `waiting-ink` is the text-safe shade; `waiting-bg` the tinted row fill.

### Tertiary
- **Agent Line Hues** (line-main, line-explore, line-plan, line-general, line-design, line-tests, line-rose, line-sky, line-orchid): one fixed hue per agent type, identical across every lens and screen. Main is an indigo-violet, Explore teal, Plan coral, general-purpose blue; squad roles reuse slots (planner = main, backend = general blue, frontend = coral, design = mustard, tests = green); custom squad roles take pool hues by the Custom Role Hue Rule below; unknown types hash into the rose / mustard / green / sky / orchid pool. Each hue has three cuts in code: `line` (the stroke), a lighter `fill` (the orb body) and a deeper `badge` (the line-code disc, white text at AA; design yellow takes dark brown text, #3b2a00).
- **Error Red** (error / error-ink / error-bg) and **Running Green** (ok / ok-ink): state only. Green is the live dot in chips and session rows; red rings an error station and colours error status text; on squads it also marks failed task stations, conflicted or reverted merge capsules, the failed-squad band and red final checks, always with an × and a word.
- **Focus Blue** (focus / select): focus outlines and the tree lens's selected-row tint. Never decoration.

### Neutral
- **Ground** (ground): canvas of the map and main column; also the station fill (`--station` follows ground per theme) and the halo behind every map label.
- **Cool Panel** (panel / panel-2): the sidebar, segmented-control track, quiet chips, hover fills; panel-2 is the hover step inside the sidebar.
- **Hairline** (hairline / hairline-strong): every divider and container border; the strong step for secondary-button borders, the dotted "now" rule and scrollbars.
- **Ink 2 / Ink 3** (ink-2 / ink-3): secondary text and metadata. ink-3 (#646b78 light, #9098a6 dark) is the floor for readable text.

### Named Rules
**The Lines Carry the Colour Rule.** Ground, panels and chrome stay neutral. Saturated hue comes from agents (lines, badges, orbs) and the three state colours. The wordmark is the one chrome exception, because it is itself three line colours orbiting a centre.

**The One Line, One Hue Rule.** An agent type owns its colour everywhere: map line, badge disc, orb body, mini-map on Home. Never recolour an agent per screen or per theme.

**The Orange Means You Rule.** Hold Orange marks only things waiting on the user. If nothing is waiting, no orange is on screen.

**The Custom Role Hue Rule.** A custom squad role draws in a pool hue (rose, sky, orchid, mustard, green, handed out in that order), allocated per plan in plan order: first the hues no built-in role of that plan comes near, then those that only resemble one (sky beside backend's blue, rose beside frontend's coral). A built-in role's exact hue (mustard while design is in the plan, green while tests is) is never handed to a custom role; past the remaining hues the order repeats and the line-code letters tell the roles apart. The slot is stable for the plan and drawn everywhere the role appears: map, badge, orb, Board, Orbit, squad rows. This is One Line, One Hue at squad scope; built-in roles always keep their kind's hue.

## Typography

**Display Font:** DM Sans Variable (with ui-sans-serif, system-ui)
**Body Font:** DM Sans Variable, optical sizing on
**Label/Mono Font:** DM Mono 400/500 (with ui-monospace, SF Mono, Menlo)

**Character:** One geometric-humanist sans set like station signage: short, sentence case, confidently weighted, slightly tightened at headline sizes. DM Mono is reserved for what the machine said: commands, file paths, raw JSON, and tabular figures.

### Hierarchy
- **Display** (700, 1.75rem, -0.02em): the single page title on Home and Project.
- **Headline** (600, 1rem): section headings (Needs you, Running now, Projects); the agent panel title uses 700 at -0.01em.
- **Title** (600, 0.8125rem): panel headings ("What's happening"), breadcrumb current item, agent names inside rows, button text (500).
- **Body** (400, 0.875rem, 1.45): default text; Happening rows and lists run at 0.8125rem.
- **Label** (500, 0.75rem): chips, metadata lines, descriptions, sidebar group label (600, ink-3, sentence case).
- **Map name** (600, 12px) and **Map signage** (600, 11px; 700 in waiting-ink when held): SVG text on the line map. Station repeat counts are 9.5px 600 tabular in ink-3.
- **Squad signage** reuses Map signage at 11px 600: station titles (ink-2 once work began, ink-3 ahead), zone names along the map's top (ink-3), phase-track stop names (current stop 700 in ink, error-ink when the squad failed). The Board's plan goal takes the 1.375rem step at 700, -0.01em; Deliver's "Ready to deliver" is Display.
- **Count** (700, 0.6875rem, tabular): numeric pills in the sidebar.
- **Mono** (DM Mono 400, 0.75rem, tabular, -0.01em): permission asks ("Bash · pnpm add jose"), paths, raw tab (11px).

### Named Rules
**The Signage Rule.** Labels are short, sentence case and bold enough to read at a glance over a busy map. No uppercase-tracked labels; uppercase appears only inside line-code discs and project initial tiles.

**The Tabular Numbers Rule.** Every count, token total and tool count uses tabular figures so numbers don't jitter as they tick.

## Layout

A fixed three-part operating frame. The sidebar is 232px on the cool panel; below 1100px it collapses to a 56px icon rail (labels become tooltips, counts move onto the icons as small badges). The session screen has a header of about 48px: the breadcrumb, then the count chips, the Git button (branch in mono and a changed-file count; it opens a right-hand panel with the branch, its pull request and the diff) and a three-way layout switch pushed right. Below it, the screen splits in two:
- **Talk, on the left:** the session's terminal, or its conversation and composer. When a session has both, a Terminal · Conversation tab chooses.
- **The map, on the right:** a resizable column, 440px by default and never under 360px, which is the narrowest Orbit fits. It holds the Lines · Orbit · Tree tabs, the lens, and "What's happening" or the agent panel under the lens.

The layout switch picks side by side, talk alone, or the map alone. The map alone is the classic frame: the lens filling the centre and a fixed 340px agent column. Hiding a side never unmounts it, so a terminal keeps its screen.

The terminal is a dark surface in both themes (the dark tokens, with the agent palette as its ANSI colours), because the CLIs in it assume a dark background. It uses DM Mono at 12.5px, under a hairline title bar that shows what runs and where. Home and Project are a centred column (max 1080px, 32px side padding, 40px between sections).

The line map fits its frame like a printed diagram: columns flex between 16px and 96px, lanes between 56px and 104px, spare height lifts the diagram 30% off the top, and the map scrolls horizontally only when it cannot fit, following "now" like a departures board unless the user scrolls back. Spacing rides Tailwind's 4px grid; the recurring steps are 4, 8, 12, 16, 20, 24, 32, 40.

The squad screen keeps the frame. Its header holds the breadcrumb (at most 380px, the squad title truncated), the phase track, then the budget meter and Pause / Stop pushed right; below 1280px the phase track switches to its compact form. A status band may sit under the header; the lens tabs are Lines · Orbit · Tasks, with Deliver first once the squad reaches it; the 340px right column stays. The squad map fits its frame like the session map, with a 136px left gutter for line names, columns between 18px and 120px and lanes between 58px and 104px. The Board is a horizontal row of 300px role strips under the plan summary and the cost / approve card. Deliver stacks the summary, the finished map in a 360px band between hairlines, then a centred column (max 1000px) of choices, final checks and changes by role; the three choices stack to one column below 860px.

## Elevation & Depth

Flat by default. Surfaces separate by tone (ground vs panel) and 1px hairlines, not by shadow. A soft two-layer shadow appears only to show "this one is selected": the active sidebar item, the active session row, the selected lens tab and the chosen delivery option sit as white tiles lifted off the gray track. Depth on the map comes from the white casing drawn under every line, so crossings read as over/under like a metro diagram.

### Shadow Vocabulary
- **Panel lift** (`box-shadow: 0 1px 2px rgb(18 20 23 / 6%), 0 4px 12px rgb(18 20 23 / 6%)`; dark: `0 1px 2px rgb(0 0 0 / 40%), 0 4px 12px rgb(0 0 0 / 30%)`): selected tile on a panel track.
- **Float** (`box-shadow: 0 2px 6px rgb(18 20 23 / 8%), 0 16px 40px rgb(18 20 23 / 12%)`; dark: `0 2px 6px rgb(0 0 0 / 40%), 0 16px 40px rgb(0 0 0 / 45%)`): floating layers only: the budget meter's per-role breakdown and the notification settings popover.

### Named Rules
**The Lift Means Selected Rule.** Shadow marks the current selection on a panel track, never a resting card. Containers use a hairline border instead.

## Shapes

Round, signage-like geometry. Controls use gently rounded corners (6px nav items and tabs, 8px buttons and rows), containers 12px, chips and counts are full pills, project initials sit on 4px tiles. The focus ring is a 2px focus-blue outline at 2px offset with 6px radius.

On the map, form is octolinear: lines are 5px with round caps and joins, run horizontally, drop vertically from their spawn station, and turn on a 45° chamfer (12px knee) into their lane; the merge back mirrors it. Under each line runs a 10px ground-coloured casing. Stations are 4.6px-radius white dots with a 2px ink ring (filled ink while the tool is running; red ring on error); a waiting station grows to a 6.5px white dot with an orange ring plus a pulsing halo. Interchanges are white capsules (13×25px, fully rounded) with a 2.2px ink ring and a pip in the branch's colour. Capsules of the same kind (spawns, or merges) on the same parent line in consecutive columns are linked: a 10px white bar with the same ink ring runs along the pip row behind them, so subagents launched together read as one interchange. Detached lines turn into a dotted "1 9" dash. The orb is a circle with a 1.6px ink ring, a soft highlight, two white eyes with ink pupils that look toward what the agent is doing, and an optional 7px glyph badge with an ink ring.

### Named Rules
**The Octolinear Rule.** Lines move only horizontally, vertically, or on a 45° knee. No free curves, no other angles.

**The Ink Ring Rule.** Every map object the eye should land on (station, interchange, orb, glyph badge) carries an ink outline, so it reads on any line colour and in both themes.

**The Knockout Rule.** Text on the map always sits on a ground halo: a 4px ground stroke painted under the glyphs, and line names on a 92% ground knockout tile, so any line crossing a label is masked as on printed maps.

## Components

### Buttons
Compact and confident; ink does the work.
- **Shape:** gently rounded (8px), 32px tall, 12px horizontal padding, 0.8125rem 500.
- **Primary:** ink fill, ground text (Allow). Hover drops to 85% ink.
- **Secondary:** ground fill, hairline-strong border, ink text (Deny). Hover fills panel.
- **Ghost:** ink-2 text, no border; hover fills panel and darkens to ink.
- **Motion:** colour transitions only, short; no lift, no scale.

### Chips
- **Style:** 24px pills, 10px padding, label type, tabular figures. The same three counts appear on every screen: running · subagents · waiting.
- **State:** live is an ink pill with a green dot; quiet is a panel pill in ink-2; waiting is a waiting-bg pill in waiting-ink with an orange dot, shown only when something is waiting. The dot is always paired with words.

### Cards / Containers
- **Corner Style:** 12px for list containers and the waiting card; 8px for rows.
- **Background:** ground; waiting card and waiting rows take waiting-bg with a 40%-orange hairline border.
- **Shadow Strategy:** none (see Lift Means Selected).
- **Border:** 1px hairline; rows inside are divided by hairlines.
- **Internal Padding:** rows 12-14px × 16-20px; side columns 20px.

### Navigation
- **Sidebar:** cool panel, 32px rows with a 16px icon, 0.8125rem 500 ink-2. Hover fills panel-2; active is a ground tile with panel lift. Projects carry an initial tile and a live count pill (orange-tinted when waiting); sessions indent under their project with a status dot and either a live count or "x min ago". Below 1100px the rail keeps icons, initial tiles and count badges only.
- **Breadcrumb:** Home › Project › Session at 0.8125rem, chevrons in ink-3, current item semibold ink.
- **Lens tabs:** segmented control on a panel track (2px inset); 28px tabs; the selected tab is a lifted ground tile. Lenses shipped: Lines · Orbit · Conversation · Tree (Lines is the default).
- **Agent panel tabs:** Story · Steps · Raw as 28px text tabs; selected fills panel.

### Line Map (signature)
The live session map. One lane per agent, main on top, branches below their parent. Each line's name sits above its lane with a line-code badge (16px disc), starting just past the spawn knee and sliding left rather than colliding with the orb. A dotted hairline-strong "now" rule marks the right edge of live time. The head of every running line carries its 30px orb, with 11px signage under it ending at the orb's right edge ("is reading sessions.ts", or "waiting for you · Bash" in bold waiting-ink). Selecting an agent dims the other lines to 60%. New lines draw themselves in (stroke-dash grow) and their orb pops in.

### Orbit (lens)
The session as a small solar system, drawn on one Canvas2D: the project is a neutral sun (ground disc, ink ring, its initial in DM Sans bold) at the centre; top-level agents are planets on a hairline ring around it; subagents are moons on their parent's ring, moons of moons smaller again. Bodies keep an angle derived from their id, so nothing jumps when the session changes; moons drift slowly (one turn per 120s) and everything glides 480ms to new places. With one planet (a plain chat, the common case) the planet is pinned to the sun's right and its system fills the pane, the sun held in the left third; with several (a squad) the planets share a ring and drift once per 180s. More than six moons on one parent collapse into a swarm cluster with a "×N" chip that opens the parent; waiting and failed moons (and any moon whose subtree needs you) always stay outside it, finished ones go in first and fade to 45%. A failed moon keeps its size and gets a 2px red ring. Orbs are the same persona as the SVG orb, from the shared rig in `@gravita/orbs`. An invisible button per body sits over the canvas for keyboard and screen readers ("Explore is reading auth.ts"); selection draws an ink ring, keyboard focus a 2px focus-blue ring outside it. The loop runs at 60fps only while a glide or spawn pop is in flight, 30fps otherwise (bounce and halo included), stops when the window is hidden, and with reduced motion only redraws on change.

### Orb (persona)
The agent as a character: fill colour from its line, ink ring, eyes whose pupils glance toward the tool, up while thinking, at the viewer while waiting, toward a child while delegating. Done closes the eyes in a smile; stopped and away fade to 45%. A glyph badge (Lucide geometry from `@gravita/orbs`, on a ground disc) shows the state where no label does; dense lists hide it. Sizes: 48 (agent panel), 32 (Happening rows), 30 (map), 24-28 (lists, tree).

### Mini Lines
A 176×44 thumbnail of a session's map on Home project rows: 3px main line, up to three 2.6px branches with 5px knees, stations and the head drawn small, orange head when waiting.

### Permission actions
Allow (primary) and Deny (secondary) inline on waiting rows, beneath a mono line of what is asked. Sessions running in the user's terminal show a terminal-icon pointer ("Answer it in the terminal where this session runs") instead of buttons.

### Squad Map (signature)
The squad as one transit system, in the Line Map's grammar. Integration is the trunk: a 5px ink line across the top, named in the gutter with an ink line-code disc, the planner's 26px orb at its origin and "Planner · status" signage under the name. Each role is a line in its hue in its own lane below, leaving the trunk before its first task on a 45° knee; each task is a station on it, one column per task in plan order; each merge is a 3.5px spur in the role's hue rising back into the trunk to an interchange capsule with a role-hue pip. Work begun is solid, the route ahead is the same line at 30% opacity, and the trunk ends at an ink terminus bar, faint until Deliver. Dotted hairline-strong rules (2 4 dash) split the line into Foundation · Build · Verify · Deliver, named along the top in 11px ink-3; a foundation stretch too short to hold its name stays unnamed. Role names sit in the left gutter beside their lanes rather than above them.
- **Stations:** quiet (pending, ready, skipped) are 4px with a 1.6px ink-3 ring, skipped adds an ink-3 slash; begun are 4.6px with a 2px ink ring, ink-filled while running, with a centre dot in review; selection adds a 9.5px ink ring; the hit area is 12px. List rows reuse the same marks at small size.
- **Stuck marks, shape plus word:** a blocked task is a 6.5px station with a 2.6px orange ring and a pulsing halo, signed "waiting for you" in waiting-ink; a failed task is the same size with a red ring and an × inside, signed "failed" in error-ink; a conflicted or reverted merge turns its capsule's ring red (2.6px) with an × in its tail and names it ("conflict", "reverted") above the trunk. The word is left out only when an orb's signage already speaks for that role.
- **Station titles:** every station carries its title in 11px signage on a ground halo, wrapped to at most two lines 72-120px wide (cut only on a third), placed on the first clear tier of four: under the station, above it, further down past signage, one row lower again. Signage and orbs are hard obstacles a title never lands on; spawn drops and merge spurs are soft, crossed on the halo only when nothing else fits.
- **Orbs:** ride the head of each working role just past its current station, signage under them; a stuck station keeps its own ring visible and no orb sits on it. A merge landing after first paint rises into the trunk with the line-grow draw, the map's one authored move.

**The Title Gap Rule.** Two station titles on the same tier keep at least 12px of air between them; a title wraps narrower, or moves tier, before it ever reads as one string with its neighbour.

### Phase Track
The squad's phases as its own short metro line in the header, never a progress bar: six stops (Brief · Plan · Foundation · Build · Verify · Deliver) 66px apart on a 4px hairline-strong track. The travelled stretch is ink; passed stops are 4.6px ink dots, stops ahead 4px hollow with ink-3 rings, the current stop a 7.5px station with a 2.4px ring and a 3px centre pip, named in 700 ink. A failed squad rings its last stop red and names it in error-ink; a stopped one rings it ink-3; done fills the whole line. Its accessible name says the stop and "n of 6".
- **Compact (below 1280px):** stops 24px apart and only the current stop named (the terminus too once done); the dots still carry the whole route.

### Budget Meter
Spent / total in tabular DM Mono at 0.8125rem (spent in ink 500, "/ total" in ink-3) over a 112×4px pill track in panel-2 with an ink fill. Figure and fill turn Hold Orange only when the budget has paused the squad; the 75% warning changes the breakdown's heading, not the colour. Hover or focus opens the per-role breakdown: a 288px ground popover, 12px radius, hairline, Float shadow; rows of 16px line badge, role name and spend / role budget (waiting-ink once a role's budget is spent).

### Squad Status Band
A full-width band under the header when the squad isn't simply running: panel with ink-2 text for a pause the user chose or a stop; waiting-bg with a 30% orange hairline and waiting-ink for a pause that waits on the user, the budget-raise field inline; error-bg with error-ink when the squad failed.

### Board Role Strips
Each role as the strip map over a train door: a 300px ground column, 12px radius, hairline. The header holds a 28px idle orb, an 18px line badge, the name (1rem 600), the role budget or "≈ estimate" tabular in ink-2, owned paths as 11px DM Mono panel tags, and the charter in ink-3 (two lines). Below, the role's 5px line runs down the column in its hue and each task is a stop: a 13px ground dot with a 2px ink ring (red when the plan check pinned an issue to it), then title, one-sentence summary, size and dependencies, paths in mono. Edit, move and remove are icon buttons beside the title, each opening an inline form in place.
- **Foundation mark:** a foundation task carries a 5px pip in the role's hue inside its stop (an ink fill already means "running" on the map, so it is not reused), plus a "Foundation" panel pill in its meta line.

### Deliver
"Ready to deliver" over the plan summary and one meta line (done / total, roles, spent of total in tabular, the branch in mono). Then the finished map: the squad map in its 360px band, every line built, the trunk solid to its terminus.
- **Choice list:** a three-option radiogroup on a panel track (12px radius, 2px inset); each tile an icon, a 0.8125rem 600 name and one ink-2 sentence; the chosen tile is a lifted ground tile (10px radius, panel lift). Choosing reveals a hairline confirmation row that names exactly what will happen, with Cancel (ghost) and the one primary action; nothing is delivered from a tile alone. An option that can't run (no `gh`) dims to 60% and says why.
- **Final checks:** a hairline list; each row an 8px status dot (green passed, red failed, hollow ink-3 not run) paired with the word and its duration, the command in mono; a red check opens its output in error-bg mono.
- **Delivered:** an ink check disc, the outcome, and the branch or pull request in mono with Copy.

### Squad Decisions
What a squad waits on the user for, one shape wherever it appears. On Home's Needs you it is a waiting-card row: the role's 22px line badge (the planner's when no role), "project › squad" in ink-2 at 0.75rem, what is needed in ink 500, the reason in waiting-ink, and a single primary action (Review plan, Deliver, Decide, Open). In the Run column, decisions sit first in an orange "N things need you" band: each stuck task shows its station mark (orange ring blocked, red ring failed) with the word, the role and the reason, then Retry (primary) and Retry with a stronger model (secondary); Reassign and Skip are ghost buttons that open inline confirmations, and reassignment offers only roles whose owned paths cover the task's writes.

### Motion
- **Chrome:** palette of 120 / 240 / 480ms on the signature ease cubic-bezier(0.2, 0, 0, 1); no overshoot. Pupils glide 240ms; new lines draw in on the signature ease.
- **Orbs (Playful):** slow sine breathing as ambient (2.4s thinking, 3.2s working, 4.2s idle, scale 1.045); a 0.7s 1.5px bob while busy; overshoot pop on spawn (480ms, cubic-bezier(0.34, 1.4, 0.64, 1)); squash-and-stretch bounce plus a pulsing orange halo when waiting; ±6° wobble on error; a blink every ~4.2s; small wander when the gaze is idle.
- **Budget (the 1/3 rule):** at most a third of visible orbs (at least one) play primary motion (pop, bounce, wobble) at once, enforced by `allocateMotion` on the line map and the orbit: someone waiting on you first, then a failure, then a fresh spawn. The rest only breathe; the orange halo, glyph and colour still tell the state. Each orb's breathing and blink start at a phase seeded by its agent id, so a list never moves in lockstep.
- **Tokens:** the timings live in `@gravita/orbs` (`tokens/motion.ts`); a test keeps `styles.css` in step with them.
- **Accessibility:** every loop and entrance lives inside `prefers-reduced-motion: no-preference`.

## Do's and Don'ts

### Do:
- **Do** give every agent type one fixed hue from the palette and use it for its line, badge, orb and mini-map alike.
- **Do** route lines octolinearly: 5px, round caps, vertical drop, 45° knee (12px), horizontal run, white casing underneath.
- **Do** put an ink ring on every station, interchange, orb and glyph badge.
- **Do** set map text on a ground halo (4px stroke, paint-order stroke) or a 92% ground knockout.
- **Do** pair every state colour with a word or shape: dot plus label, ring plus "waiting for you".
- **Do** use tabular figures for all counts, and DM Mono for commands, paths and raw payloads.
- **Do** keep chrome motion on the signature ease cubic-bezier(0.2, 0, 0, 1) within 120 / 240 / 480ms, and put every animation behind prefers-reduced-motion.
- **Do** mark selection on a panel track with the lifted ground tile (panel lift shadow).

### Don't:
- **Don't** tint the ground, panels or chrome with agent hues (the three-line wordmark is the only exception).
- **Don't** use Hold Orange for anything that isn't waiting on the user.
- **Don't** draw lines with free curves or angles other than 0°, 90° and 45°.
- **Don't** give resting cards or containers a shadow; use a hairline.
- **Don't** use overshoot, bounce or wobble in chrome; those belong to the orbs.
- **Don't** set uppercase tracked labels or eyebrow text above headings; signage is sentence case.
- **Don't** let a terminal, a log feed or a gray card grid be the only view of a session: the map is always one click away, and side by side by default. The terminal is a way to talk to the agent, not a replacement for seeing it.
