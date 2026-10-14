# T03 — Protocolo: adicionar o provider `cursor`

- **Status:** review (implementado e verificado localmente em 2026-10-14; não commitado, sem PR)
- **Fase:** 1 — Tipos e core
- **Dependências:** T01 (confirma modos, nome do `EventSource` e estados de validação)
- **Estimativa:** M

## Objetivo

Fazer `"cursor"` existir em todos os tipos/schemas do contrato `@gravita/protocol`, sem
oferecê-lo ainda em squads nem no terminal.

## Contexto

`AGENT_PROVIDERS` alimenta `AgentProviderSchema` (zod) e o tipo `AgentProvider`, usado no
engine e no desktop. Adicionar o valor faz o TypeScript apontar todos os
`Record<AgentProvider, …>` exaustivos — esses ajustes ficam em T04/T05/T11 (mesmo PR se
preferir manter o typecheck verde; ver "Passos").

## Arquivos afetados

- `packages/protocol/src/constants.ts` — `AGENT_PROVIDERS = ["claude","codex","cursor"]`;
  `CURSOR_MODES = ["agent","plan","ask"] as const`; comentário de `SQUAD_PROVIDER_CHOICES`
  e `TERMINAL_COMMANDS` (inalterados)
- `packages/protocol/src/events.ts` — `ProviderSchema` com `"cursor"`; `EventSource` com
  `"cursor-acp"`; `CursorModeSchema`; `SessionModeSchema` com união tripla
- `packages/protocol/src/ids.ts` — `Provider` com `"cursor"`
- `packages/protocol/src/rpc.ts` — `EngineStatus.providers.cursor: ProviderStatus.optional()`;
  `ProviderStatus.credential` opcional
  (`{ source: "app"|"none", state: "missing"|"unchecked"|"valid"|"invalid" }`, com
  `source: "none"` ⇔ `state: "missing"`; nunca o valor da chave — P8: não existe origem
  `env`/`login`); `CursorKeyValidateResult` (mesma forma de `credential`);
  re-export de `CURSOR_MODES`
- `packages/protocol/src/constants.ts` — `Methods.cursorKeyValidate = "cursorKey.validate"`
  (sem parâmetros: o engine valida a chave que já tem em memória)
- `packages/protocol/src/index.ts` — exports
- `packages/protocol/test/providers.test.ts`, `contract.test.ts` — testes de schema

## Passos

1. Adicionar constantes e schemas acima.
2. Atenção a `SessionSettings.permissionMode` (`PermissionModeSchema`, termos do Claude):
   decidir com T04 se sessões Cursor gravam o modo traduzido para termos do Claude (como o
   Codex faz) — default: sim.
3. Rodar `pnpm typecheck` e anotar a lista de erros: ela é o checklist de T04/T05/T11.
   Para manter `main` verde, este PR pode incluir os stubs mínimos (entradas `cursor` nos
   `Record` exaustivos) ou ser mergeado junto com T04.

## Critérios de aceite

- `AgentProviderSchema.parse("cursor")` ok; `SessionModeSchema.parse("plan")` ok;
  `EngineStatus` aceita `providers.cursor` com `credential`; `source` fora de `app|none`
  é rejeitado.
- Nenhum schema do protocolo tem campo para o **valor** da chave (teste de contrato:
  nenhum método aceita/retorna `apiKey`/`key`) — a chave nunca transita pelo WebSocket (R14).
- Clientes antigos continuam funcionando (`providers.cursor` é opcional).
- Typecheck do monorepo verde (com stubs) ou PR combinado com T04.

## Como testar

`pnpm --filter @gravita/protocol test && pnpm typecheck`

## Notas de execução

- `AGENT_PROVIDERS` inclui `cursor`; `SQUAD_AGENT_PROVIDERS` continua `claude`/`codex`.
- `CURSOR_MODES = ["agent","plan","ask"]`, `CREDENTIAL_SOURCES` (`app`/`none`),
  `CREDENTIAL_STATES` (`missing`/`unchecked`/`valid`/`invalid`), união
  `ProviderCredential` (`none` ⇔ `missing`), `ProviderStatus.credential`,
  `Methods.cursorKeyValidate` (`cursorKey.validate`, sem parâmetros; devolve só o estado).
- `SessionSettings.providerMode` (o modo no termo do provider quando o de Claude não diz —
  o Ask do Cursor). `EngineStatus.providers.cursor` é opcional (engines antigos).
- Testes: `packages/protocol/test/providers.test.ts`.
