# T14 — (Pós-MVP) Terminal embutido rodando `cursor-agent`

- **Status:** done
- **Fase:** Pós-MVP
- **Dependências:** T10
- **Estimativa:** P

## Objetivo

Permitir abrir o `cursor-agent` interativo do usuário num terminal dentro do gravita, como
já é feito com `claude` e `codex` (ADR 007).

## Arquivos afetados

- `packages/protocol/src/constants.ts` — `TERMINAL_COMMANDS` com `"cursor"`
- `apps/engine/src/domain/terminal-command.ts` — `cursorArgs(l)` (`--resume <chatId>`,
  `--model`, `--mode plan|ask`, prompt) e `terminalArgv` sem ternário binário
- `apps/engine/src/infrastructure/terminal/provider-terminal-flags.ts` — `modeArgs`,
  `resumeArg`, `sessionIdOf` para `cursor`
- `apps/engine/src/application/usecases/spawn-terminal.ts`
- `apps/desktop/src/features/terminal/TerminalScreen.tsx` + i18n
- Testes: `apps/engine/test/domain/terminal-command.test.ts`, `application/terminals.test.ts`

## Critérios de aceite

- Mesma regra de credencial dos chats (P8, D2): só a chave do app, com o mesmo env do T08
  (sem `CURSOR_*`/`AGENT_CLI_*` herdada, `AGENT_CLI_CREDENTIAL_STORE=memory`); sem chave,
  o terminal Cursor não abre (CTA para configurar). Pré-requisito: estender a exceção D6
  no ADR 008 para cobrir terminais Cursor (hoje vale só para os processos ACP), incluindo
  como tratar a máscara de segredo na saída do PTY.
- Terminais de outros providers (e o terminal `shell`) nunca recebem `CURSOR_API_KEY`.
- Sessões de terminal **não** recebem `GRAVITA_MANAGED`.

## Como testar

`pnpm --filter @gravita/engine test -- terminal`

## Notas de execução

Feito. O terminal Cursor também aparece no mapa (linhas, órbita e árvore) pela leitura da transcrição do CLI (ADR 008, emenda “observing terminal chats”).
