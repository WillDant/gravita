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

## Commits
Conventional commits (`feat:`, `fix:`, …) and DCO sign-off (`git commit -s`). Architecture changes get an ADR in `docs/adr/`.
