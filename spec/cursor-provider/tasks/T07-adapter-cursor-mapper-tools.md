# T07 — `@gravita/adapter-cursor`: mapper de eventos, tool calls e fixtures

- **Status:** review (implementado e verificado localmente em 2026-10-14; não commitado, sem PR)
- **Fase:** 2 — Adapter puro
- **Dependências:** T06, fixtures do T01
- **Estimativa:** G

## Objetivo

Transformar o stream ACP em `GravitaEvent`s determinísticos e as tool calls do Cursor em
`GuardedCall`s neutros, com servidor ACP roteirizado para os testes do engine.

## Contexto

Molde: `packages/adapter-codex/src/app-server/rpc-mapper.ts` (`CodexRpcMapper`),
`src/tools.ts` (`codexToolCall`, `codexToolKind`), `src/testing/scripted-app-server.ts`,
`fixtures/codex-rpc/`. Tabela de contrato neutra:
`apps/engine/test/contracts/guarded-call-table.ts`. Eventos disponíveis em
`packages/protocol/src/events.ts` (mensagens, tool start/complete, usage, errors…).

## Arquivos afetados

- `packages/adapter-cursor/src/acp/mapper.ts` _novo_ — `CursorAcpMapper`:
  - `agent_message_chunk` / `agent_thought_chunk` → blocos de mensagem/raciocínio
    (agregação por mensagem; chave `keys.assistantBlock(...)` estável por turno + índice)
  - `tool_call` → `tool.started`; `tool_call_update` (`completed`/`failed`) → `tool.completed`
  - `plan` → evento de todos/plano (se houver equivalente) ou ignorado com nota
  - `current_mode_update` → `session.settings`
  - fim de turno (`stopReason` do `session/prompt`) → `turn` completo
- **Máscara de segredo (R13):** o mapper recebe no construtor `redact: (text) => string`
  (default identidade) e a aplica a **todo** texto que vira evento (mensagens,
  raciocínio, previews de input/output de ferramentas, erros). O engine (T09) passa uma
  função que troca o valor exato da chave por `••••`.
- `packages/adapter-cursor/src/tools.ts` _novo_ — `cursorToolKind` (ACP `read`, `edit`,
  `delete`, `move`, `search`, `execute`, `think`, `fetch`, `switch_mode`, `other` →
  `ToolKind` do gravita), `cursorToolCall` → `GuardedCall {kind, paths (de `locations`),
  command (de `rawInput`), tool, cwd}`, `cursorInputPreview`
- `packages/adapter-cursor/src/testing/scripted-acp-server.ts` _novo_ — replay de
  `fixtures/cursor-acp/<versão>/*.jsonl`, responde requests do cliente
- `fixtures/cursor-acp/<versão>/*.jsonl` _novo_ (do T01)
- `apps/engine/test/contracts/guarded-call-table.ts` — casos Cursor
- `packages/adapter-cursor/test/mapper.test.ts`, `tools.test.ts`

## Passos

1. Mapper puro com `now()` injetado e `projectId/sessionId` no construtor (como o Codex).
2. Garantir idempotência: replay duplo da fixture gera exatamente as mesmas chaves.
3. `cursorToolCall` + casos na tabela de contrato (read em cwd → allow por política, edit
   fora do ownership → deny, execute → shell…).
4. Servidor roteirizado exportado em `@gravita/adapter-cursor/testing`.

## Critérios de aceite

- Fixtures cobrem: texto, raciocínio, leitura, edição, comando, permissão aceita/negada,
  cancelamento, erro de auth.
- Campos desconhecidos no payload não quebram o mapper (log e segue).
- Fixture em que um comando imprime uma chave sentinela gera eventos sem o valor.
- Tabela de contrato verde para o adaptador Cursor.

## Como testar

`pnpm --filter @gravita/adapter-cursor test && pnpm --filter @gravita/engine test -- contracts`

## Notas de execução

- `acp/mapper.ts`: `session/update` ⇒ eventos (texto, ferramentas, plano, modo/modelo,
  título), turnos com `beginTurn`/`endTurn`, chaves de dedupe estáveis em replay, `redact`
  aplicado a todo texto (a chave vira `••••`).
- `tools.ts`: `cursorToolName`/`cursorToolCall` para o guard; `redact.ts` (`maskSecret`).
- `testing/scripted-acp-server.ts` (reaproveita o formato do `ScriptedAppServer`, que
  ganhou `defer`/`reply`); fixtures sintéticas em `fixtures/cursor-acp/2026.10.14/`
  (9 cenários).
- Testes: `mapper.test.ts` (11), `tools.test.ts`; `apps/engine/test/domain/guarded-call.test.ts`
  cobre uma chamada Cursor por intenção da GUARD_TABLE. Total do pacote: 23 testes.
