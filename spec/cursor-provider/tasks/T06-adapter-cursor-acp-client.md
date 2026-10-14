# T06 — `@gravita/adapter-cursor`: pacote, tipos ACP, cliente e ids

- **Status:** review (implementado e verificado localmente em 2026-10-14; não commitado, sem PR)
- **Fase:** 2 — Adapter puro
- **Dependências:** T01 (formato real), T03
- **Estimativa:** M

## Objetivo

Criar o pacote puro (sem spawn de processo) que fala ACP sobre qualquer stream de bytes,
com tipos mínimos e ids com prefixo `cursor:`.

## Contexto

Molde: `packages/adapter-codex/src/app-server/` (`json-rpc.ts`, `client.ts`, `methods.ts`)
e `src/ids.ts`. `JsonRpcConnection` (newline-delimited JSON-RPC 2.0, requests do servidor
respondidos por handler, limites de tamanho) é genérico e exportado por
`@gravita/adapter-codex` — **reusar** no MVP (decisão D4).

## Arquivos afetados (todos _novos_ salvo indicação)

- `packages/adapter-cursor/package.json` (`@gravita/adapter-cursor`, exports `.` e
  `./testing`; deps `@gravita/protocol`, `@gravita/adapter-codex`, `zod`)
- `packages/adapter-cursor/tsconfig.json`
- `packages/adapter-cursor/src/index.ts`
- `packages/adapter-cursor/src/acp/types.ts` — só os tipos usados (initialize,
  authenticate, session/new, session/load, session/prompt + `stopReason`,
  `session/update` e suas variantes, `session/request_permission` + opções,
  `session/cancel`, `session/set_mode`, `session/set_model`), com a versão de protocolo
- `packages/adapter-cursor/src/acp/methods.ts` — mapas método → params/result (como
  `adapter-codex/src/app-server/methods.ts`)
- `packages/adapter-cursor/src/acp/client.ts` — `CursorAcpClient` (handshake
  `initialize` com `clientInfo {name:"gravita"}`, `clientCapabilities` sem `fs` e sem
  `terminal`, `call`, `notify`, handlers `onNotification`/`onRequest`/`onClose`)
- `packages/adapter-cursor/src/ids.ts` — `CURSOR_PREFIX = "cursor:"`, `cursorSessionId`,
  `cursorCallId`, `acpSessionIdOf`
- `packages/adapter-cursor/test/client.test.ts`, `ids.test.ts`
- `pnpm-workspace.yaml` (se precisar), `apps/engine/package.json` (dep workspace)

## Passos

1. Scaffold do pacote copiando config de `adapter-codex`.
2. Tipos ACP mínimos (TypeScript; zod só onde o payload entra no engine e precisa validação).
3. Cliente sobre `JsonRpcConnection`; timeouts de handshake como `HANDSHAKE_TIMEOUT_MS`.
4. Ids determinísticos; testes de idempotência (`ns()` não duplica prefixo).

## Critérios de aceite

- Pacote não importa `node:child_process`/`Bun.spawn`.
- Handshake e requests testados contra um transporte em memória.
- `fs/*` e `terminal/*` pedidos pelo servidor são recusados (capabilities `false`).

## Como testar

`pnpm --filter @gravita/adapter-cursor test && pnpm typecheck`

## Notas de execução

- Pacote `packages/adapter-cursor`: `ids` (`cursor:<id>`), `acp/types`, `acp/methods`,
  `acp/client` (`AcpClient` sobre o `JsonRpcConnection` do adapter-codex).
- O ACP exige `"jsonrpc":"2.0"` em cada mensagem: o `JsonRpcConnection` ganhou a opção
  `envelope`, usada só pelo cliente do Cursor (o Codex segue sem o campo).
- O cliente **nunca** chama `authenticate` (T01: ele abre o login no navegador);
  pedidos desconhecidos do servidor recebem -32601; `session/cancel` é notificação.
- Testes: `client.test.ts`, `ids.test.ts`.
