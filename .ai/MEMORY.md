# Memória e decisões — gravita

> Atualizar após sessões relevantes. Decisões formais do projeto ficam em `docs/adr/`.

## Decisões recentes

- **2026-10-14:** Pasta `.ai/` inicializada a partir do README, CONTRIBUTING e ADR 006 — contexto para fluxo DCC neste fork/workspace (`control-center/gravita`).

## Débitos técnicos

- (Nenhum registrado localmente neste workspace — consultar issues/PRs upstream e `docs/ROADMAP.md` para polish pré-launch.)

## Sessões DCC / agente

- **2026-10-14:** Preenchimento de `CONTEXT.md`, `MAP.md`, `MEMORY.md` e esboço de backlog em `TASKS.md` para assistir desenvolvimento futuro sem duplicar ADRs.

## Pontos que agentes costumam errar

- Assumir Next.js ou API REST — o transporte é **WebSocket JSON-RPC** (+ alguns POSTs de controle no engine).
- Colocar I/O em `@gravita/core` — proibido por design.
- Editar `packages/adapter-codex/src/app-server/protocol/` à mão — regenerar com `bun tools/vendor-codex-protocol.ts`.
- Esquecer idempotência ao introduzir novos `GravitaEvent`.
- `EngineStatus.claude` está **deprecated** em favor de `EngineStatus.providers` (compat UI antiga).
