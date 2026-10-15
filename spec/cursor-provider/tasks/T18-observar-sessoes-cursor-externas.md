# T18 — (Pós-MVP) Observar sessões Cursor iniciadas fora do gravita

- **Status:** parcial — feito para o terminal do Gravita (transcrição + meta.json, ADR 008); falta o editor e o CLI fora do Gravita
- **Fase:** Pós-MVP
- **Dependências:** T10, T13
- **Estimativa:** G

## Objetivo

Mostrar no mapa de linhas sessões Cursor que o usuário iniciou fora do gravita (CLI ou
editor), como já acontece com Claude Code e Codex. Fora do MVP por decisão **P6**.

## Contexto

Claude e Codex são observados por leitura de transcripts locais
(`infrastructure/claude/claude-session-source.ts`, `infrastructure/codex/codex-session-source.ts`,
`infrastructure/sessions/tail-scheduler.ts`). O Cursor guarda estado em `~/.cursor` (`chats/`, `acp-sessions/`), mas o
`COMPLIANCE.md` (após T02/T13) diz que o gravita **não** lê `~/.cursor`. Esta tarefa
precisa primeiro decidir se e o que pode ser lido.

## Passos (alto nível)

1. Investigar formato e estabilidade dos arquivos em `~/.cursor` (sem credenciais).
2. Propor allowlist de caminhos legíveis e atualizar ADR 008 / `COMPLIANCE.md`.
3. Watcher + mapper para `GravitaEvent` (reaproveitar `adapter-cursor` se o formato for ACP).
4. Testes de compliance: arquivos de credencial/config nunca abertos.

## Critérios de aceite

- A definir quando a tarefa for priorizada.

## Notas de execução
