# T04 — Core: modos e modelos do Cursor

- **Status:** review (implementado e verificado localmente em 2026-10-14; não commitado, sem PR)
- **Fase:** 1 — Tipos e core
- **Dependências:** T03 (P3 decidido: só Agent/Plan/Ask, sem acesso total)
- **Estimativa:** P

## Objetivo

Ensinar ao `@gravita/core` (puro) os modos do Cursor, seu modo padrão e o mapeamento para os
modos do Claude, e satisfazer as tabelas exaustivas de modelos sem habilitar squads Cursor.

## Contexto

`packages/core/src/session-modes.ts` hoje é binário (`provider === "codex" ? … : claude`).
Mapeamento (P3 decidido em 2026-10-14 — sem "acesso total"):

| Claude (`PermissionMode`) | Cursor |
|---------------------------|--------|
| `default` | `agent` (pede aprovação) |
| `acceptEdits` | `agent` |
| `plan` | `plan` |
| `bypassPermissions` | `agent` (sem bypass no MVP) |

| Cursor | Claude |
|--------|--------|
| `agent` | `default` |
| `plan` | `plan` |
| `ask` | `plan` (somente leitura; o mais próximo) |

`packages/core/src/squad/models.ts` tem `PROVIDER_MODELS ... satisfies Record<AgentProvider, …>`.

## Arquivos afetados

- `packages/core/src/session-modes.ts` — `CURSOR_MODE_OF`, `CLAUDE_MODE_OF_CURSOR`,
  `isCursorMode`, `asCursorMode`, `DEFAULT_MODE.cursor = "agent"`, `isModeOf`/`modeFor`
  com `switch` exaustivo
- `packages/core/src/squad/models.ts` — **sem tiers para Cursor** (squads cancelado, P5):
  trocar `satisfies Record<AgentProvider, …>` por um tipo só dos providers de squad
  (`SquadProvider = "claude" | "codex"`)
- `packages/core/src/squad/providers.ts` — `allowedProviders` nunca devolve `cursor`
  (permanente, não provisório)
- `packages/core/src/index.ts` — exports
- `packages/core/test/providers.test.ts`, `squad-providers.test.ts`, `squad-validate.test.ts`

## Passos

1. Implementar os mapas e helpers com `switch (provider)` + `never` check.
2. Ajustar `PROVIDER_MODELS`.
3. Testes de ida e volta dos modos e de `isModeOf` para os três providers.

## Critérios de aceite

- Nenhum ramo `else` implícito tratando Cursor como Claude em `session-modes.ts`.
- `validatePlan` rejeita role com `provider: "cursor"` (squads cancelado — P5).
- Nenhum modo do Cursor equivale a acesso total.
- `pnpm --filter @gravita/core test` verde.

## Como testar

`pnpm --filter @gravita/core test && pnpm typecheck`

## Notas de execução

- `session-modes.ts`: `isCursorMode`, `asCursorMode`, `modeFor` exaustivo (switch com
  `unknownProvider`), `DEFAULT_MODE.cursor = "agent"`, `settingsModeOf(provider, mode)` ⇒
  `{permissionMode, providerMode?}` (Agent ⇒ `default`, Plan ⇒ `plan`, Ask ⇒ `plan` +
  `providerMode: "ask"`).
- Projeção guarda `providerMode` do evento `session.settings` (e apaga quando ausente).
- Squads: tipos de provider de squad continuam sem `cursor`.
- Testes: `packages/core/test/providers.test.ts`, `squad-providers.test.ts`.
