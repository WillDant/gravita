# Tarefas — gravita

> Backlog local do workspace DCC. Roadmap oficial: `docs/ROADMAP.md`. Não substitui issues do GitHub.

## Em progresso

- (nenhuma)

## Backlog (priorizado)

- [ ] **Cursor como provider (API key)** — plano e tarefas em `spec/cursor-provider/`; status em `spec/BOARD.md` (começar por T01)

Itens alinhados ao milestone **Polish and public launch** (próximo no roadmap upstream):

- [ ] Replay com scrubber na timeline de sessão
- [ ] Revisão completa de copy em português (`shared/i18n/locales/pt-BR.ts` e strings relacionadas)
- [ ] Builds assinados/notarizados + updater in-app
- [ ] Landing page e documentação pública
- [ ] Tour in-app e auditoria de acessibilidade

Manutenção / qualidade (quando solicitado):

- [ ] Rodar `pnpm test`, `pnpm typecheck`, `pnpm lint` antes de PR
- [ ] Novas features de arquitetura: ADR em `docs/adr/` + wire em `container.ts` e contrato em `protocol`

## Bloqueios

- Nenhum registrado neste workspace.

## Como usar com DCC

1. Mover item para **Em progresso** com critérios de aceite explícitos.
2. Ao concluir, registrar resumo em `MEMORY.md` e marcar `[x]` ou remover.
3. Decisões duradouras → ADR, não só MEMORY.
