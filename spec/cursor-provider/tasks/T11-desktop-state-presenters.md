# T11 — Desktop: estado, presenters, ponte da chave e gateway fake

- **Status:** review (implementado e verificado localmente em 2026-10-14; não commitado, sem PR)
- **Fase:** 4 — Desktop
- **Dependências:** T03, T05, T17 (comandos Tauri da chave)
- **Estimativa:** M

## Objetivo

Fazer a camada de estado e os presenters do desktop entenderem `cursor` (status,
credencial, problemas, erros, rótulos) e expor à UI as operações da chave, sem ainda mexer
em telas.

## Contexto

`apps/desktop/src/state/hooks.ts` (`providerStatus`, `problemOf`, `canStartWith`,
`useCodexNote`, `useModels`), `state/slices/control.ts`, `shared/presenters/errors.ts`
(`PROVIDER_COPY`), `shared/presenters/selectors.ts`, `infrastructure/engine/GatewayError.ts`,
`infrastructure/platform/tauri.ts`, `test/FakeGateway.ts`.

## Arquivos afetados

- `apps/desktop/src/state/hooks.ts`
  - `canStartWith(status, "cursor")` (demo ⇒ false; exige CLI encontrado, credencial
    `source === "app"` e `state ≠ invalid`)
  - `problemOf` ganha `keyMissing` ("chave não configurada", CTA para configurar) e
    `keyInvalid` para o Cursor — distintos de `missing` (CLI não instalado ⇒ nota
    opcional, P7). Com CLI ausente, prevalece `missing`
  - `useCursorNote()` análogo a `useCodexNote` (Cursor opcional, P7)
  - `useCursorKey()` — `{ present, source, state, save(key), remove(), validate() }`
- `apps/desktop/src/infrastructure/platform/tauri.ts` — `cursorKeySet`, `cursorKeyRemove`,
  `cursorKeyPresent` (no navegador sem Tauri: indisponível, a UI esconde o campo e o
  Cursor fica "chave não configurada" — configurar só no app desktop)
- `apps/desktop/src/infrastructure/engine/*` — chamada `cursorKey.validate`
- `apps/desktop/src/shared/presenters/errors.ts` — `PROVIDER_COPY.cursor`
- `apps/desktop/src/shared/presenters/selectors.ts`, `agent.ts` — sem ternário binário
- `apps/desktop/src/infrastructure/engine/GatewayError.ts` — `provider` aceita `cursor`
- `apps/desktop/src/test/FakeGateway.ts` — `providers.cursor` com `credential`; fake da
  ponte Tauri
- `apps/desktop/src/shared/i18n/locales/en.ts`, `pt-BR.ts` — `error.cursor*`
- Testes: `errors.test.ts`, `agent.test.ts`, `hooks` da chave

## Passos

1. Hooks e presenters; tipos guiam pelo typecheck.
2. Ponte Tauri da chave; fora do Tauri ela responde "indisponível".
3. Chaves de i18n de erro (en + pt-BR).
4. Testes para os três providers e para os estados da credencial.

## Critérios de aceite

- `describeError` com `data.provider:"cursor"` mostra texto do Cursor e `connect.provider = "cursor"`.
- `canStartWith`/`problemOf` corretos para found/outdated/keyMissing/keyInvalid/demo.
- A chave digitada só passa por `cursorKeySet`; nenhum estado do store a guarda depois.
- `pnpm --filter @gravita/desktop test` verde.

## Como testar

`pnpm --filter @gravita/desktop test && pnpm typecheck`

## Notas de execução

- `hooks.ts`: `problemOf` dá `keyMissing`/`keyInvalid` ao Cursor (CLI ausente/antigo
  prevalece; `loggedIn` nunca vale para o Cursor); `optionalNoteOf` (Codex e Cursor),
  `useCursorNote`, `useCursorCredential`, `useOfferedProviders`.
- **Desvio do plano:** `canStartWith(status, "cursor")` exige só CLI encontrado e atual
  (como Claude deslogado). Sem chave válida o Cursor continua oferecido em "New session",
  e o painel da chave aparece no lugar dos passos de conexão; se o usuário inicia mesmo
  assim, o engine recusa (`notLoggedIn`) sem iniciar processo e o painel da chave aparece.
  Assim a CTA de configurar fica onde o usuário escolhe o Cursor.
- `useCursorKey()` fica em `features/connect/useCursorKey.ts` (precisa da ponte e do
  gateway, que vivem em `app/providers`).
- Ponte Tauri: `createCursorKeyBridge()` (`present`/`set`/`remove`; ausente no navegador),
  injetada por `AppServices.cursorKey`. A chave digitada vai direto ao `set`; nenhum estado
  React ou do store a guarda (campo não controlado, limpo depois de salvar; teste confere).
- Gateway: `validateCursorKey()` (WS e `FakeGateway`).
- `describeError`: `providerUnavailable`/`notLoggedIn` com `provider: "cursor"` ⇒ texto do
  Cursor e `connect {provider: "cursor", problem: "keyMissing"}` (o painel lê o estado real).
- Testes: `ConnectProvider.test.tsx`, `errors.test.ts`.
