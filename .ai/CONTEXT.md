# Contexto do Projeto: gravita

**Gravita** — ver e dirigir agentes de código (Claude Code, Codex, Cursor) e subagentes em todos os projetos. Mapa de linhas ao vivo, chat/terminal integrado, squads em worktrees. **v0.8.2-beta** (preview macOS). Licença Apache-2.0.

## Tech stack e versões

- **Linguagem/Runtime:** Node.js **≥ 22**, TypeScript **7.0.2**, ESM (`"type": "module"`)
- **Monorepo:** pnpm **10.34.5**, Turborepo **2.11.7**
- **Engine:** Bun **≥ 1.4** (`apps/engine`) — sidecar compilável, SQLite, WebSocket JSON-RPC
- **Desktop:** React **19.3**, Vite **8.3**, Tailwind **4.3**, Tauri **2.12**, Zustand, Vitest (UI); Rust só no shell Tauri
- **Validação/contratos:** Zod **4.6** em `@gravita/protocol`
- **Lint/format:** Biome **2.5.15** (indent 2, line width 100, double quotes, semicolons always)
- **Banco de dados:** SQLite no engine (event store + checkpoints) — não há Postgres/Supabase no app
- **UI:** Tailwind 4 + componentes em `apps/desktop/src/shared/ui`; motion com `motion`; i18n `en` + `pt-BR`
- **Agentes externos:** CLI do usuário (`claude`, `codex`, `cursor-agent` opcional via ACP com chave da API no Keychain); Agent SDK Anthropic no engine; protocolo Codex app-server vendored em adapter-codex

## Convenções e padrões

- **Arquitetura:** Clean Architecture no engine e desktop — **domain ← application ← infrastructure/interface ← main**; camadas internas não importam externas (ver `docs/adr/006-clean-architecture.md`)
- **Pacotes:** `@gravita/*` — `protocol` (eventos + RPC zod), `core` (reducer/projeção, **sem I/O**), `orbs` (render orbit/lens), adapters (`adapter-claude`, `adapter-codex`, `adapter-cursor`, `adapter-fake`)
- **Eventos:** uma fonte de verdade — tudo normaliza para `GravitaEvent` com chave de idempotência determinística
- **Nomenclatura:** código em inglês; camelCase / PascalCase; branches `feat/area-kebab`; **não** usar códigos M0/M1 no código
- **Commits:** Conventional Commits `type(area): imperative summary`, corpo com o porquê, **DCO** (`git commit -s`); mudanças de arquitetura → ADR em `docs/adr/`
- **PRs:** título estilo commit; template em `.github/pull_request_template.md`; features grandes em passos nomeados no roadmap
- **Testes:** `packages/*` e engine com **Bun test**; desktop com **Vitest**; parsers/reducers com fixtures em `fixtures/`; property tests no core onde existem

## Restrições (do / don't)

1. **Compliance:** não ler credenciais Claude, não escrever em `~/.claude`, não oferecer login Claude — ver `docs/COMPLIANCE.md`
2. **`packages/core` permanece puro** (sem `fs`, rede, `Date.now` direto no domínio de aplicação do engine — usar ports/`Clock`)
3. **Nunca commitar transcripts reais** em `fixtures/` — só sintéticos modelados na estrutura real
4. **Não empacotar Claude Code** — SDK aponta para o `claude` do usuário (`pathToClaudeCodeExecutable`); optional deps do SDK por plataforma ignoradas no pnpm
5. **Acessibilidade:** estado do agente não só por cor; respeitar `prefers-reduced-motion`
6. **Dependências:** checar orçamento de bundle (`pnpm check:bundle`) antes de acrescentar deps pesadas
7. **Turborepo:** antes de alterar `turbo.json`/comandos, ler docs do pacote `turbo` instalado (ver bloco em `AGENTS.md`)

## Documentação interna

- README e develop: `README.md`
- Contribuição e naming: `CONTRIBUTING.md`
- Squad, Codex, Cursor, Deep Observe: `docs/squad.md`, `docs/codex.md`, `docs/cursor.md`, `docs/deep-observe.md`
- Roadmap: `docs/ROADMAP.md`
- ADRs: `docs/adr/` (001 sidecar, 002 transport, 003 ids, 004 squad ownership, 005 compliance, 006 clean arch, 007 terminal)
- Planos de iniciativas: `spec/` (ver `spec/README.md` e `spec/BOARD.md`); contrato RPC/eventos vive em `packages/protocol`

## Comandos úteis (dev)

```bash
pnpm install
pnpm --filter @gravita/engine dev:demo    # engine demo, porta 4319
pnpm --filter @gravita/desktop dev        # UI http://127.0.0.1:5173
pnpm --filter @gravita/desktop tauri dev  # app desktop (Rust)
pnpm test && pnpm typecheck && pnpm lint
```

## Extensão típica (para agentes)

- **Nova fonte de eventos:** adapter + `infrastructure/<fonte>/` no engine → `IngestEvents`; wire em `main/container.ts`
- **Novo RPC:** schemas em `RpcContract` (`protocol`) → use case em `application/usecases/` → linha em `interface/rpc/router.ts`
- **UI:** `features/` + gateway (`EngineGateway` / `WsEngineGateway`); estado em `state/slices/`
