# T16 — Squads com roles no Cursor

- **Status:** dropped
- **Fase:** — (cancelada)
- **Dependências:** —
- **Estimativa:** —

## Motivo

Cancelada em 2026-10-14 pela decisão **P5** ("sem squads com Cursor"). Não é "futuro":
não entra no backlog. As consequências permanentes estão em T04 (tipo `SquadProvider`
sem `cursor`, `allowedProviders` nunca oferece Cursor) e T05 (pontos de squad seguem
binários com guarda).

## Se um dia for reaberta

Exige nova decisão do dono do produto e um ADR. Ponto de partida técnico: o ACP aceita
`mcpServers` HTTP em `session/new` (`mcpCapabilities.http = true`), então o
`LoopbackMcpServer` do Codex poderia servir as role tools.

## Notas de execução
