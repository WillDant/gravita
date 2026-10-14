# BOARD — status das tarefas

> Atualize a linha da tarefa **e** o campo "Status" do arquivo da tarefa ao mudar de estado.
> Legenda e regras em [`README.md`](README.md).

## cursor-provider — Cursor como provider via API key

Visão geral: [`cursor-provider/00-overview.md`](cursor-provider/00-overview.md) ·
Decisões e riscos: [`cursor-provider/riscos-e-perguntas.md`](cursor-provider/riscos-e-perguntas.md)
(P1–P8 decididas em 2026-10-14; nenhuma pergunta aberta)

| ID | Tarefa | Fase | Depende de | Est. | Status |
|----|--------|------|------------|------|--------|
| [T01](cursor-provider/tasks/T01-spike-acp-cursor-agent.md) | Spike: ACP, chave por env, isolamento do login salvo, validação, Keychain, fixtures, versão mínima | 0 | — | M | review |
| [T02](cursor-provider/tasks/T02-adr-cursor-provider.md) | ADR 008 + exceção de credencial no `COMPLIANCE.md` | 0 | T01 | M | review |
| [T03](cursor-provider/tasks/T03-protocol-cursor-provider.md) | Protocolo: `cursor`, `CURSOR_MODES`, status de credencial, `cursorKey.validate` | 1 | T01 | M | review |
| [T04](cursor-provider/tasks/T04-core-cursor-modes-models.md) | Core: modos Agent/Plan/Ask, mapeamento com Claude, `SquadProvider` sem cursor | 1 | T03 | P | review |
| [T05](cursor-provider/tasks/T05-refactor-provider-ternaries.md) | Trocar ternários binários por tabelas exaustivas (squad fica binário com guarda) | 1 | T03, T04 | M | review |
| [T06](cursor-provider/tasks/T06-adapter-cursor-acp-client.md) | `adapter-cursor`: pacote, tipos ACP, cliente, ids `cursor:` | 2 | T01, T03 | M | review |
| [T07](cursor-provider/tasks/T07-adapter-cursor-mapper-tools.md) | `adapter-cursor`: mapper com máscara de segredo, `cursorToolCall`, fixtures, servidor roteirizado | 2 | T06 | G | review |
| [T17](cursor-provider/tasks/T17-api-key-ui-keychain.md) | **Chave da API:** Keychain no shell Tauri, entrega por stdin, `CredentialSource` | 3 | T01, T02, T03 | G | review |
| [T08](cursor-provider/tasks/T08-engine-cursor-detection-env.md) | Engine: detector, env sem fallback (só a chave do app), validação, status da credencial | 3 | T05, T17 | M | review |
| [T09](cursor-provider/tasks/T09-engine-cursor-acp-runtime.md) | Engine: `CursorAcpRuntime`, injeção da chave, Auto padrão, máscara | 3 | T07, T08 | G | review |
| [T10](cursor-provider/tasks/T10-engine-wiring-container.md) | Engine: wiring, `cursorKey.validate`, modelos, status | 3 | T08, T09, T17 | M | review |
| [T11](cursor-provider/tasks/T11-desktop-state-presenters.md) | Desktop: estado, presenters, ponte Tauri da chave, gateway fake | 4 | T05, T17 | M | review |
| [T12](cursor-provider/tasks/T12-desktop-ui-i18n.md) | Desktop: New session, Configurações (chave Cursor), modos/modelos, marca, guia, i18n | 4 | T10, T11 | G | review |
| [T13](cursor-provider/tasks/T13-docs-compliance.md) | Docs e testes de compliance (uma prova por promessa da exceção) | 5 | T02, T10, T12, T17 | M | review |
| [T14](cursor-provider/tasks/T14-terminal-cursor-agent.md) | (Pós-MVP) Terminal embutido com `cursor-agent` | Pós | T10 | P | blocked |
| [T15](cursor-provider/tasks/T15-conversation-lens-cursor.md) | (Pós-MVP) Lente Conversation para sessões Cursor | Pós | T10 | M | blocked |
| [T18](cursor-provider/tasks/T18-observar-sessoes-cursor-externas.md) | (Pós-MVP) Observar sessões Cursor externas (P6) | Pós | T10, T13 | G | blocked |
| [T16](cursor-provider/tasks/T16-squads-cursor.md) | Squads com Cursor — cancelada (P5) | — | — | — | dropped |

**Caminho crítico do MVP:** T01 → T02 → T17 → T08 → T09 → T10 → T12 → T13.

Trilhas paralelas:
- Tipos e adapter: T03 → T04 → T05 e T03 → T06 → T07 (precisam estar prontos antes de T08/T09).
- Desktop: T11 começa assim que T05 e T17 terminarem, em paralelo com T08–T10.

**Estado em 2026-10-14:** T01–T13 e T17 implementados e verificados localmente (não
commitados, sem PR) ⇒ `review`. Pendente: as verificações ao vivo com uma chave real
(lista no T01 e roteiro manual em `docs/cursor.md`). T14, T15 e T18 (pós-MVP) não foram
iniciados.

**P8 (decidida):** a credencial vem só da chave configurada na UI; sem fallback para o
shell nem para o login do `cursor-agent`. Sem chave, o Cursor fica "chave não configurada".
