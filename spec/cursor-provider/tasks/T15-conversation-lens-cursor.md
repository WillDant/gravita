# T15 — (Pós-MVP) Lente Conversation para sessões Cursor

- **Status:** blocked (T10)
- **Fase:** Pós-MVP
- **Dependências:** T10; achados do T01 sobre `session/load`
- **Estimativa:** M

## Objetivo

Mostrar o texto completo da conversa de uma sessão Cursor na lente Conversation, sem ler
arquivos internos do Cursor.

## Contexto

`TranscriptRouter` (`apps/engine/src/application/services/transcript-router.ts`) envia
`session.conversation` ao reader do provider; sem reader ⇒ lista vazia. O gravita guarda só
previews (240 chars) no banco. Opções:
1. Buffer em memória por sessão viva, alimentado pelo mapper (some ao reiniciar o engine).
2. Replay via `session/load` num processo ACP curto (se o T01 mostrar que o histórico é
   reemitido como `session/update`).

## Arquivos afetados

- `apps/engine/src/infrastructure/cursor/cursor-transcript-reader.ts` _novo_
- `apps/engine/src/main/container.ts` (`TranscriptRouter` com `cursor`)
- `packages/adapter-cursor/src/conversation.ts` _novo_ (montagem pura de `ConversationMessage[]`)

## Critérios de aceite

- Conversa de sessão Cursor viva aparece completa; após reinício, comportamento documentado.
- Nenhum arquivo de `~/.cursor` é lido.

## Como testar

`pnpm --filter @gravita/engine test`

## Notas de execução
