# Contributing to Gravita

Thanks for helping. Gravita is early; issues and small PRs are the best way in.

## Setup
See the README: `pnpm install`, then run the demo engine and the UI. You don't need Rust, Claude Code or an account to work on the UI: the demo engine plays scripted agents.

## Ground rules
- **Compliance first.** Read `docs/COMPLIANCE.md`. Never add code that reads Claude credentials, writes under `~/.claude`, or offers a Claude login.
- **One event model.** New sources map into `GravitaEvent` (`packages/protocol`). Give every event a deterministic idempotency key.
- **Pure core.** `packages/core` stays free of I/O so it runs in the engine, the UI and tests alike.
- **Light by default.** Check the bundle and memory budgets in the README before adding a dependency.
- **Accessibility.** Agent state is never shown by colour alone; respect `prefers-reduced-motion`.

## Fixtures
Transcript fixtures live in `fixtures/claude/<cli-version>/<scenario>/`. Never commit real transcripts: they contain prompts, code and paths. Synthetic fixtures modelled on the real structure are preferred.

## Tests
`pnpm test` runs every package's tests. Parser and reducer changes need a fixture-backed test; reducer changes should keep the property tests (duplicate- and order-independence) passing.

## Naming
Anyone should understand a branch, a pull request or a document without knowing how the work was planned. Name things by what they do, in English, and never by internal milestone codes ("M2b"): the roadmap's milestones have plain names (`docs/ROADMAP.md`).

**Branches:** `<type>/<area>-<what-it-does>`, short and kebab-case.

- Types: `feat`, `fix`, `docs`, `refactor`, `test`, `ci`, `chore`.
- Areas: `squad`, `chat`, `orbit`, `line-map`, `engine`, `desktop`, `tray`, `plugin`, `codex`, `release` (add one when a new product area appears).
- Examples: `feat/codex-chatgpt-sign-in`, `fix/squad-budget-overrun`, `docs/naming-conventions`.

**Pull requests:** the title is a plain sentence about the outcome, with the area in front, like a commit: `feat(squad): start a squad from an empty folder`. The description follows the template (`.github/pull_request_template.md`): what and why for someone who wasn't there, which roadmap item it belongs to and which step (for example "Codex support · step 2 of 4: sign in with ChatGPT"), whether it's stacked on another PR, how to test, screens for UI work, and risks.

**Large features** ship in steps. Each step gets its own descriptive branch and PR (`feat/codex-app-server-adapter`, "feat(codex): app-server adapter"), and the description says which step of how many it is.

**Code, tests and docs** name the feature, not the moment it was built: "Addendum: the brief as a conversation", not "Addendum (M2d)"; `describe("chat control contract")`, not `describe("M1b contract")`. Releases are named by their version (`v0.2.0-beta`).

## Commits
Conventional commits, `type(area): imperative summary` (`feat(squad): …`, `fix(engine): …`), with a body that explains why. DCO sign-off (`git commit -s`). Architecture changes get an ADR in `docs/adr/`.
