# Onboarding

Welcome to **Holons**. This page gets a new contributor productive in about 30
minutes. For the conceptual picture read [`README.md`](./README.md) and
[`docs/architecture.md`](./docs/architecture.md) first; for a hands-on first
change, follow the [`TUTORIAL.md`](./TUTORIAL.md).

## 1. The one idea to internalize

There is **one source of truth for behavior**: `@holons/core`. Every interface
(web, Telegram, CLI, AI, MCP) is a thin renderer over it. If you change *what an
action means*, change it in `@holons/core` and every UI inherits it. If you
change *how it looks*, change it in the UI only. Never duplicate domain logic
into a UI.

Data lives in **Holosphere** — signed Nostr events on relays, mirrored into a
local store, namespaced per holon (group) and local-first. There is no
central server of record.

## 2. Environment

| Requirement | Version |
| --- | --- |
| Node | ≥ 20 |
| pnpm | ≥ 10 (`corepack enable`) |
| OS | macOS / Linux / WSL |

```bash
git clone https://github.com/HolonicLabs/holons.git
cd holons
pnpm install
pnpm -r typecheck && pnpm test     # should be green on a clean clone
```

## 3. Repository map

```
apps/web/              holons-web — Svelte 5 dashboard (primary UI)
packages/core/         @holons/core — all domain logic (start here)
packages/telegram-ui/  Telegraf bot
packages/text-ui/      CLI / REPL
packages/ai-ui/        Claude tool-use natural-language interface
packages/mcp-ui/       Model Context Protocol server
docs/                  architecture, realtime-sync, user guide, federation
```

`@holons/core/src/<domain>/` holds the ~16 domains (scoring, tasks,
expenses, federation, users, calendar, library, …). Each is reached via a
subpath import: `import { ... } from '@holons/core/<domain>'`.

## 4. Run what you'll touch

```bash
cp apps/web/.env.example apps/web/.env     # fill only the keys you need
pnpm dev                                   # web → http://localhost:5173
pnpm dev:bot                               # Telegram bot
pnpm -F @holons/text-ui exec holons --help # CLI
```

Secrets (`.env`, `.mcp.json`) are gitignored — never commit them.

## 5. Your first contribution

1. Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) and the
   [`CLA.md`](./CLA.md) (accepted via signed-off commits / CLA check).
2. Branch from `main`: `feat/<topic>` or `fix/<topic>`.
3. Make the change in `@holons/core` (with a `vitest` spec) before any UI work.
4. `pnpm -r typecheck && pnpm test && pnpm lint` must pass.
5. Commit with `git commit -s` (Conventional Commits, scoped).
6. Open a PR against `main` using the template.

The [`TUTORIAL.md`](./TUTORIAL.md) walks through exactly this with a concrete
example.

## 6. Where to get unstuck

- **Architecture/data flow:** [`docs/architecture.md`](./docs/architecture.md)
- **Sync behavior:** [`docs/realtime-sync.md`](./docs/realtime-sync.md)
- **AI-agent conventions & guardrails:** [`CLAUDE.md`](./CLAUDE.md)
- **A package's specifics:** that package's `README.md`
- **Security concerns:** [`SECURITY.md`](./SECURITY.md) (never a public issue)

Open a draft PR or discussion early — questions are welcome.
