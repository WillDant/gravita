# T10 — Engine: ligar o Cursor no composition root

- **Status:** review (implementado e verificado localmente em 2026-10-14; não commitado, sem PR)
- **Fase:** 3 — Engine
- **Dependências:** T08, T09, T17
- **Estimativa:** M

## Objetivo

Registrar detector, ambiente, `CredentialSource`, factory, catálogo de modelos e o RPC
`cursorKey.validate` em `main/container.ts`, para que `session.start {provider:"cursor"}`,
`models.list` e `engine.status` funcionem no engine real.

## Contexto

`apps/engine/src/main/container.ts`: `createCore()` monta `RuntimeFactoryRegistry`,
`ListModels`, `PlanUsageMonitor`; `startEngine()` monta `detectors: ProviderDetector[]` e
`ChatOptions`. Router: `apps/engine/src/interface/rpc/router.ts` já é neutro.
`main.ts` (T17) entrega o `CredentialSource` alimentado pelo stdin.

## Arquivos afetados

- `apps/engine/src/main/container.ts`
  - `ChatOptions.cursorEnvironment?: AgentEnvironmentSource`, `cursorLaunch?` (testes)
  - `EngineOptions.credentials?: CredentialSource` (default: em memória vazia — modo
    browser/dev sem Tauri fica com o Cursor em "chave não configurada"; não há fallback)
  - `EngineOptions.detectCursor?: () => Promise<ProviderStatus>` (testes não procuram o CLI real)
  - `detectors.push(new CursorDetector(...))`
  - `RuntimeFactoryRegistry({ claude, codex?, cursor? })`
  - `ListModels(..., DEFAULT_FALLBACKS, { codex, cursor? })`
  - revisar `if (provider === "codex" && …)` pós-detecção (linha ~815)
- `apps/engine/src/main/main.ts` — repassar o `CredentialSource` criado no T17
- `apps/engine/src/interface/rpc/router.ts` — handler `cursorKey.validate` (sem parâmetros;
  chama a validação do T08 e devolve só `credential`)
- `apps/engine/src/application/usecases/list-models.ts` — `DEFAULT_FALLBACKS.cursor =
  [{ value: "default", displayName: "Auto" }]`
- `apps/engine/src/application/services/event-broadcaster.ts` — status inicial
- `apps/engine/test/main/container.test.ts`, `application/providers.test.ts`,
  `application/chat-usecases.test.ts`, `interface/router.test.ts`

## Passos

1. Wiring condicional (sem `cursorEnvironment` ⇒ Cursor não registrado, como o Codex).
2. Catálogo de modelos antes de qualquer sessão: lista da última sessão viva; se não
   houver, "Auto" (P4).
3. `cursorKey.validate` + teste de que a resposta não contém a chave.
4. Testes: `detectCursor` fake publica `providers.cursor.credential`; `session.start` com
   provider `cursor` chega à factory; `providerUnavailable` com `data.provider:"cursor"`
   quando não detectado; `notLoggedIn` com `data.provider:"cursor"` quando detectado mas
   sem chave do app; trocar a chave no `CredentialSource` fake republica o status.

## Critérios de aceite

- `engine.status` inclui `providers.cursor` com `credential` após a detecção.
- `session.start {provider:"cursor"}` funciona ponta a ponta com o servidor roteirizado.
- `cursorKey.validate` devolve `valid`/`invalid`/`unchecked` sem ecoar a chave.
- Modo demo inalterado (Cursor não aparece).

## Como testar

`pnpm --filter @gravita/engine test && pnpm typecheck`

Manual: `pnpm --filter @gravita/desktop tauri dev` com `cursor-agent` instalado, colando a
chave na UI (T12). Sem Tauri (engine + Vite), o Cursor aparece como "chave não
configurada" e não inicia sessões — exportar `CURSOR_API_KEY` no shell não muda isso (P8).
Testes de dev usam o `CredentialSource` fake.

## Notas de execução

- `container.ts`: `CursorDetector` no status; `CursorKeyStatus` + `watch()` (chave nova ⇒
  `unchecked` na hora e checagem em seguida; removida ⇒ `none`/`missing`); fábrica
  registrada no `RuntimeFactoryRegistry`; prefixo `cursor:` no resolver de transcript.
- Router: `cursorKey.validate` (sem Cursor ⇒ `providerUnavailable`).
- `list-models`: fallback do Cursor = Auto.
- `main.ts`: lê o stdin de bootstrap (token na 1ª linha, linhas `cursorKey` depois) e passa
  a `MemoryCredentialSource` ao engine.
- Suite completa do engine fora do sandbox: 559 pass, 0 fail (dentro do sandbox, testes de
  git/pty falham por restrição do ambiente, não do código).
