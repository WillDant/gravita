# Gravita

See and steer every AI coding agent (Claude Code, Codex, Cursor) and its subagents across projects. pnpm + Turborepo monorepo: a Bun engine sidecar (`apps/engine`), a Tauri + React desktop app (`apps/desktop`), and `@gravita/*` packages. Read `.ai/CONTEXT.md` (stack, conventions, do/don't) and `.ai/MAP.md` (layout, data flow) before non-trivial work.

## Commands

```bash
pnpm install
pnpm --filter @gravita/desktop dev        # UI on http://127.0.0.1:5173
pnpm --filter @gravita/engine dev:demo    # demo engine on port 4319, no account needed
pnpm typecheck && pnpm lint && pnpm test
```

- Desktop tests: from `apps/desktop`, `npx vitest run`. Node 22.11 fails with `ERR_REQUIRE_ESM` from jsdom; use a newer 22.x (22.22 works).
- Lint and format are Biome (`pnpm lint`; `npx biome check --write <path>` fixes formatting).
- Before touching `turbo.json` or Turborepo commands, follow `AGENTS.md`.

## Rules that bite

- **Compliance:** never read Claude credentials, write under `~/.claude`, or offer a Claude login (`docs/COMPLIANCE.md`).
- **Layers:** domain ← application ← infrastructure/interface ← main; inner layers never import outer ones (`docs/adr/006-clean-architecture.md`). `packages/core` stays free of I/O.
- **One event model:** every source maps into `GravitaEvent` (`packages/protocol`) with a deterministic idempotency key.
- **UI:** every user-facing string goes in both `shared/i18n/locales/en.ts` and `pt-BR.ts`. Agent state is never colour alone; respect `prefers-reduced-motion`.
- **Fixtures:** only synthetic transcripts, never real ones.
- Architecture changes get an ADR in `docs/adr/`. Plans for larger work live in `spec/`.

## Git

- Branches `<type>/<area>-<what-it-does>` (`feat/desktop-session-welcome`); name things by what they do, never by milestone codes.
- Conventional commits `type(area): imperative summary`, body explains why, DCO sign-off (`git commit -s`).
- PR descriptions follow `.github/pull_request_template.md`. Details in `CONTRIBUTING.md`.
