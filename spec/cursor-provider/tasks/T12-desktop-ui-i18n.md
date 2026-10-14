# T12 — Desktop: telas do Cursor, tela da chave e i18n

- **Status:** review (implementado e verificado localmente em 2026-10-14; não commitado, sem PR)
- **Fase:** 4 — Desktop
- **Dependências:** T10, T11 (P3, P4, P7, P8 decididos)
- **Estimativa:** G

## Objetivo

Deixar o usuário escolher Cursor em "New session", **configurar a chave da API na UI**
(adicionar, substituir, validar, remover), ver modos e modelos do Cursor nas configurações
da sessão, identificar sessões Cursor e receber guia quando o CLI estiver
ausente/desatualizado.

## Contexto

Telas e componentes listados em `../01-analise-atual.md` → Desktop. Não existe tela de
configurações. Regras visuais: `ProviderMark` é uma pílula com contorno, nunca cor de
marca; Claude fica sem marca. Acessibilidade: estado não só por cor; respeitar
`prefers-reduced-motion`.

## Arquivos afetados

- `apps/desktop/src/features/connect/CursorKey.tsx` _novo_ — campo mascarado
  (`type="password"`, sem autocomplete), botões **Salvar**, **Validar**, **Substituir**,
  **Remover** (com confirmação); mostra o estado (`não configurada`/`não verificada`/
  `válida`/`inválida` — a origem é sempre a chave do app, P8; nada de "usando a chave do
  shell" ou "login do cursor-agent"); depois de salvar, o campo é limpo e só aparece
  "Chave configurada"; link para onde gerar a chave (Cursor Dashboard → Integrations)
- Ponto de entrada da chave:
  - tela **Configurações** (`#/settings`, item no sidebar) com `CursorKey`;
  - na Home, `CursorKeyLine` com link para Configurações;
  - em `NewSessionPanel` / `ConnectProvider` para `keyMissing`/`keyInvalid`: aviso +
    botão "Abrir configurações" (sem formulário embutido)
- `apps/desktop/src/features/new-session/NewSessionPanel.tsx`, `useNewSession.ts` —
  "providers disponíveis" em lista; modo padrão `agent`; modelo padrão Auto (P4)
- `apps/desktop/src/features/session-settings/SettingsSelects.tsx` —
  `PROVIDER_MODES.cursor` com `CURSOR_MODES` e rótulos `mode.cursor.<modo>`; `fullAccess`
  opcional no tipo (Cursor não tem — P3); `MODEL_DEFAULT.cursor` = "Auto"
- `apps/desktop/src/shared/ui/ProviderMark.tsx` — `cursor: { name: "Cursor", short: "Cu", … }`
- `apps/desktop/src/features/connect/ConnectProvider.tsx` — `GUIDES.cursor`:
  - missing (CLI não instalado): comando oficial de instalação (confirmar no T01) + nota
    "opcional" (P7)
  - outdated: `cursor-agent update`
  - keyMissing ("chave não configurada") / keyInvalid: abre `CursorKey`; o guia **não**
    sugere `cursor-agent login` nem `export CURSOR_API_KEY` (não têm efeito — P8)
- `apps/desktop/src/features/session/agent-panel/AgentPanel.tsx`, `features/home/Home.tsx`
  — provider da sessão; Home não mostra uso de plano do Cursor
- `apps/desktop/src/shared/i18n/locales/en.ts`, `pt-BR.ts` — `newSession.provider.cursor`,
  `mode.cursor.{agent,plan,ask}`, `connect.cursor.*`, `cursorKey.*`, `provider.cursor.session`
- Testes: `CursorKey.test.tsx` _novo_, `NewSessionPanel.test.tsx`,
  `ConnectProvider.test.tsx`, `ProviderMark.test.tsx`, `Composer.test.tsx`, `locales.test.ts`

## Passos

1. `CursorKey` + entradas na New session, ConnectProvider e Home.
2. Modos/modelos/marca/guia, reaproveitando os padrões do Codex.
3. Copy em inglês e português.
4. Testes com `FakeGateway` e fake da ponte Tauri: sem chave, chave válida, inválida,
   remoção, CLI ausente × chave ausente (mensagens distintas), navegador sem Tauri
   (campo oculto, Cursor "chave não configurada" com aviso de que a chave só é
   configurada no app desktop).
5. `pnpm --filter @gravita/desktop build && pnpm check:bundle`.

## Critérios de aceite

- No app Tauri: colar a chave → validada → iniciar chat Cursor, aprovar ferramenta,
  trocar modo/modelo, interromper; chave inválida → mensagem + substituir; remover →
  "chave não configurada" e Cursor indisponível em "New session" (CTA para configurar),
  mesmo com `CURSOR_API_KEY` no shell ou login do `cursor-agent`.
- A chave nunca é reexibida nem fica em estado React após salvar.
- CLI ausente → nota discreta "opcional", sem bloquear Claude/Codex; CLI presente sem
  chave → "chave não configurada" (estado distinto, com CTA).
- Locales completos; orçamento de bundle respeitado.

## Como testar

`pnpm --filter @gravita/desktop test && pnpm check:bundle`

## Notas de execução

- `features/connect/CursorKey.tsx`: campo `password` sem autocomplete; Salvar, Verificar,
  Substituir, Remover (com confirmação); estados em texto (não só cor); "só no app desktop"
  no navegador. O link do painel do Cursor é texto (o opener do shell só abre páginas da
  OpenAI; não ampliei o escopo dele).
- Entradas: **Configurações** (`#/settings`, sidebar + `Settings.tsx` com `CursorKey`);
  Home (`CursorKeyLine` → link para Configurações); `ConnectProvider` / "New session"
  (`keyMissing`/`keyInvalid` ⇒ aviso + "Abrir configurações", sem formulário aninhado).
- `GUIDES.cursor`: instalar `curl https://cursor.com/install -fsS | bash` (instalador
  oficial; **não rodado ao vivo**), atualizar `cursor-agent update`. Nada de
  `cursor-agent login` nem `export CURSOR_API_KEY`.
- "New session": a escolha lista os providers que podem rodar; Cursor só em chat (sem
  "Run in"); modos Agent/Plan/Ask sem full access; modelo padrão "Auto".
- `SettingsSelects`: `PROVIDER_MODES.cursor` (`fullAccess`/`warning` opcionais),
  `MODEL_DEFAULT.cursor`. Composer usa `providerMode` (mostra o Ask do Cursor).
- `ProviderMark`: `Cursor`/`Cu`. `CodexNote` aceita `provider` (nota de CLI ausente/antigo).
- `WatchingBar`/`useNewSession`: Cursor não abre terminal (T14 não feito).
- Strings en + pt-BR (`cursorKey.*`, `connect.cursor.*`, `home.cursor.*`, `mode.cursor.*`,
  `newSession.provider.cursor`, `newSession.modelDefaultCursor`, `provider.cursor.session`,
  `error.cursor*`).
- Testes: `CursorKey.test.tsx` (8), `NewSessionPanel.test.tsx` (+4), `Composer.test.tsx`
  (+1), `ProviderMark.test.tsx` (+1). Desktop: 306/306; `vite build` ok; bundle dentro do
  orçamento (entry 113,3 KB / 250 KB gzip).
- Ambiente: o Vitest exige Node ≥ 22.12 (o `jsdom` faz `require()` de ESM); com o Node
  22.11.0 padrão do nvm a suite nem inicia. Rodei com o Node 22.23.3 já instalado.
