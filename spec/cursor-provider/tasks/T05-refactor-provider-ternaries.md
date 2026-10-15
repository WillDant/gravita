# T05 — Trocar ternários binários de provider por tabelas exaustivas

- **Status:** review (implementado e verificado localmente em 2026-10-14; não commitado, sem PR)
- **Fase:** 1 — Tipos e core
- **Dependências:** T03, T04
- **Estimativa:** M

## Objetivo

Garantir que nenhum ponto do código trate `cursor` como Claude por cair no `else` de um
`provider === "codex" ? … : …`.

## Contexto

Lista completa (com linhas) em `../01-analise-atual.md` → "Pontos com ternário binário".
Padrão sugerido: um helper de nome exibível no lado do engine/domain
(`providerName(provider): "Claude Code" | "Codex" | "Cursor"`) e `switch` exaustivo com
`const _never: never = provider` onde a lógica difere. Pontos só de **squad** ficam
binários **permanentemente** (squads com Cursor foi cancelado — P5), com o tipo
`SquadProvider` do T04 ou uma guarda explícita.

## Arquivos afetados

Engine / domain:
- `apps/engine/src/domain/errors.ts` (3 mensagens)
- `apps/engine/src/domain/chat-policy.ts` (`modesOf`)
- `apps/engine/src/application/squad/task-runner.ts:176`, `prompts.ts`,
  `squad-orchestrator.ts:119,135` (guardas de squad)
- `apps/engine/src/infrastructure/demo/demo-runtime.ts:47`

Core:
- `packages/core/src/squad/plan-usage.ts:41`, `validate-plan.ts:324`, `models.ts:91,111,199`,
  `providers.ts:32`

Desktop (só os não-squad aqui; squads na guarda):
- `apps/desktop/src/shared/presenters/selectors.ts:37`
- `apps/desktop/src/features/session/agent-panel/AgentPanel.tsx:196`
- `apps/desktop/src/state/hooks.ts:61,91`
- `apps/desktop/src/shared/presenters/planUsage.ts:19`

Terminal (deixar guardado até T14):
- `apps/engine/src/domain/terminal-command.ts:60`,
  `apps/engine/src/infrastructure/terminal/provider-terminal-flags.ts`,
  `apps/engine/src/application/usecases/spawn-terminal.ts:74,81`

Fake/demo:
- `packages/adapter-fake/src/script.ts` (demo continua só Claude/Codex)

## Passos

1. Criar o helper de nome (engine `domain/` e, se útil, `@gravita/core` para o desktop).
2. Migrar cada ponto da lista; onde for squad/terminal, adicionar guarda/comentário.
3. Rodar a busca `rg '(===|!==) "(codex|claude)"' apps packages` e justificar o que sobrar.

## Critérios de aceite

- Mensagens de erro dizem "Cursor" para `provider: "cursor"` (teste em `domain`).
- Sessão Cursor no desktop não é rotulada/estilizada como Claude (teste de presenter).
- Nenhuma mudança de comportamento para Claude/Codex (suíte existente verde).

## Como testar

`pnpm test && pnpm typecheck && pnpm lint`

## Notas de execução

- Engine: `chat-policy`, `squad-policy`, `session-settings`, `plan-usage-monitor`,
  `squad-orchestrator`, `task-runner` e `list-models` sem ternário binário de provider
  (tabelas/switch exaustivos; squad fica binário com guarda `SquadAgentProvider`).
- Core: `squad/models.ts`, `squad/providers.ts`.
- Desktop (feito com o T11/T12): `sessionProvider` reconhece os três; `AgentPanel` usa
  `sessionProvider`; o Board de squad tipa o provider como `SquadAgentProvider`.
- Ficaram binários de propósito (squad nunca tem Cursor): `NewSquadPanel`, `squadOrbit`,
  `SquadMap`.
