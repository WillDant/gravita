# spec/ — orquestração de trabalho planejado

Esta pasta guarda **especificações e planos de implementação** de iniciativas maiores do
gravita, quebrados em tarefas atômicas que humanos ou agentes podem pegar uma de cada vez.
Ela não substitui `docs/` (documentação do produto) nem `docs/adr/` (decisões duradouras):
quando uma decisão de spec vira definitiva, ela é registrada como ADR e a spec aponta para ele.

## Estrutura

```text
spec/
├── README.md                 # este arquivo: convenções e como pegar tarefas
├── BOARD.md                  # quadro com o status de todas as tarefas de todas as iniciativas
└── <iniciativa>/             # uma pasta por iniciativa (ex.: cursor-provider/)
    ├── 00-overview.md        # objetivo, escopo, não-objetivos, decisões e abordagem
    ├── 01-analise-atual.md   # mapa do código atual relevante (caminhos e símbolos reais)
    ├── 02-gap-analysis.md    # o que falta, por camada
    ├── 03-plano-implementacao.md  # fases, dependências, critérios de aceite por fase
    ├── riscos-e-perguntas.md # riscos e perguntas em aberto para o dono do produto
    └── tasks/
        └── Txx-<slug>.md     # uma tarefa atômica por arquivo
```

## Iniciativas

| Pasta | Objetivo | Status |
|-------|----------|--------|
| [`cursor-provider/`](cursor-provider/00-overview.md) | Cursor como terceiro provider (ao lado de Claude Code e Codex), usando a assinatura Cursor via API key configurada na UI | MVP implementado, em revisão (T01–T13, T17); verificações ao vivo pendentes |

## Legenda de status

| Status | Significado |
|--------|-------------|
| `todo` | Pronta para começar (dependências satisfeitas ou nenhuma) |
| `blocked` | Depende de outra tarefa ou de uma decisão em `riscos-e-perguntas.md` |
| `doing` | Alguém está trabalhando nela (anote quem/qual branch no arquivo da tarefa) |
| `review` | PR aberto, aguardando revisão |
| `done` | Mergeada; critérios de aceite verificados |
| `dropped` | Descartada (registre o porquê no arquivo da tarefa) |

## Como um agente (ou pessoa) pega uma tarefa

1. Abra `BOARD.md` e escolha a primeira tarefa `todo` da iniciativa, respeitando a ordem das
   fases e a coluna de dependências.
2. Leia `00-overview.md` e o arquivo da tarefa por completo. Leia os arquivos listados em
   "Arquivos afetados" antes de editar.
3. Mude o status para `doing` **no arquivo da tarefa e no `BOARD.md`** e anote a branch
   (`feat/<area>-<kebab>`, ver `CONTRIBUTING.md`).
4. Implemente seguindo as convenções do repositório (`.ai/CONTEXT.md`, `AGENTS.md`,
   ADR 006 — Clean Architecture). Uma tarefa = um PR, salvo indicação contrária.
5. Rode o que a seção "Como testar" pede, e sempre `pnpm test && pnpm typecheck && pnpm lint`.
6. Marque `review` ao abrir o PR e `done` após o merge. Se algo do plano mudou, atualize o
   arquivo da tarefa (seção "Notas de execução") e, se for decisão duradoura, o ADR.

## Formato de um arquivo de tarefa

Todo `tasks/Txx-*.md` tem estas seções, nesta ordem:

- **Status** · **Fase** · **Dependências** · **Estimativa** (P/M/G)
- **Objetivo** — uma ou duas frases
- **Contexto** — por que existe e o que precisa saber
- **Arquivos afetados** — caminhos reais (novos marcados com _novo_)
- **Passos** — lista ordenada
- **Critérios de aceite** — verificáveis
- **Como testar** — comandos e cenários
- **Notas de execução** — preenchida por quem executa (decisões locais, desvios)

## Regras

- Documentos de `spec/` são escritos em **português do Brasil**; código e identificadores
  seguem em inglês (convenção do repo).
- Não use códigos de milestone (M0, M1…) no código-fonte; eles só existem aqui e no roadmap.
- Perguntas em aberto bloqueiam só as tarefas que dependem delas: marque `blocked` e aponte a
  pergunta (ex.: `P2`).
