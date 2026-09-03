<div align="center">

# Holons

**One source of truth for holonic coordination — five UIs sharing it.**

[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg)](./LICENSE.md)
[![Commercial license available](https://img.shields.io/badge/license-Commercial-green.svg)](./LICENSE-COMMERCIAL.md)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933.svg)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-%E2%89%A510-F69220.svg)](https://pnpm.io)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

[Quick start](#quick-start) · [Architecture](#architecture) · [Docs](./docs/README.md) · [Tutorial](./TUTORIAL.md) · [Contributing](./CONTRIBUTING.md) · [Licensing](./LICENSING.md)

</div>

---

Holons is a toolkit for **agent-centric, federated group coordination** —
tasks, governance, shared expenses, a community library, scoring, and
federation between groups. It is built so that the *meaning* of an action
("complete a task", "tally a vote", "publish to federation") is identical no
matter which interface you use it from.

The repository is a **pnpm monorepo**: a single UI-agnostic domain core
(`@holons/core`) plus five interfaces that all call into it.

## Why this exists

Most coordination tools lock your group's data inside one app and one company.
Holons is **local-first and federated**: data lives in a decentralized
relay-backed event store (the *Holosphere* layer), every group ("holon")
owns its namespace, and groups federate peer-to-peer without a central
authority. The same domain logic drives a web dashboard, a Telegram bot, a CLI,
a natural-language agent, and an MCP server — so you can meet your community
where it already is.

## Architecture

```
            ┌───────────────────────────────────────────────────────────┐
            │                       @holons/core                         │
            │  scoring · tasks · federation · holosphere · shopping ·     │
            │  settings · dna · users · expenses · calendar · library ·  │
            │  checklists · categories · commands · rea                   │
            └───────────────────────────────────────────────────────────┘
                ▲            ▲            ▲            ▲            ▲
                │            │            │            │            │
          ┌──────────┐ ┌───────────┐ ┌─────────┐ ┌─────────┐ ┌──────────┐
          │holons-web│ │telegram-ui│ │ text-ui │ │  ai-ui  │ │  mcp-ui  │
          │ (Svelte 5)│ │ (Telegraf)│ │  (CLI)  │ │ (Claude)│ │  (MCP)   │
          └──────────┘ └───────────┘ └─────────┘ └─────────┘ └──────────┘
                └────────────┴────────────┴────────────┴───────────┘
                                       │
                 Holosphere — signed events on Nostr relays
                    (local-first store, relay-synced)
```

Core never imports a UI framework; UIs never re-implement domain rules. Full
details in [`docs/architecture.md`](./docs/architecture.md).

## Packages

| Package | Path | What it owns |
| --- | --- | --- |
| `@holons/core` | `packages/core/` | UI-agnostic domain logic: scoring, tasks, federation, Holosphere I/O, shopping, settings, DNA, users, expenses, calendar, library, checklists, categories, commands, REA event store (ValueFlows ontology). |
| `holons-web` | `apps/web/` | Svelte 5 / SvelteKit web dashboard — the primary UI (maps, governance, federation, expenses). |
| `@holons/telegram-ui` | `packages/telegram-ui/` | Telegraf Telegram bot. Stateful chat interface over `@holons/core`. |
| `@holons/text-ui` | `packages/text-ui/` | Framework-agnostic CLI/REPL renderer over `@holons/core/commands`. |
| `@holons/ai-ui` | `packages/ai-ui/` | Natural-language interface: Claude (Anthropic SDK) tool-use loop exposing core actions. |
| `@holons/mcp-ui` | `packages/mcp-ui/` | Model Context Protocol server exposing every core function as a callable tool. |

## Quick start

Requires **Node ≥ 20** and **pnpm ≥ 10**.

```bash
git clone https://github.com/HolonicLabs/holons.git
cd holons
pnpm install                 # one workspace install, one lockfile
pnpm -r typecheck            # typecheck every package
pnpm -r build                # build every package
pnpm test                    # run the vitest suites

cp apps/web/.env.example apps/web/.env   # fill in tokens you need
pnpm dev                     # start the web UI  → http://localhost:5173
```

Run any single interface:

```bash
pnpm dev:bot                                  # Telegram bot
pnpm -F @holons/text-ui  exec holons --help   # CLI
pnpm -F @holons/ai-ui    exec holons-ai "create a task to fix the roof"  # needs ANTHROPIC_API_KEY
node packages/mcp-ui/dist/index.js            # MCP server (stdio)
```

New here? Start with the **[Tutorial](./TUTORIAL.md)** (run the stack and make
your first change) and the **[Onboarding guide](./ONBOARDING.md)**.

## Documentation

- [`docs/README.md`](./docs/README.md) — documentation index
- [`docs/architecture.md`](./docs/architecture.md) — how the layers and data flow fit
- [`docs/realtime-sync.md`](./docs/realtime-sync.md) — how Holosphere sync works
- [`docs/USER_GUIDE.md`](./docs/USER_GUIDE.md) — end-user guide
- [`docs/FEDERATION_COMPONENT.md`](./docs/FEDERATION_COMPONENT.md) — federation feature
- [`CLAUDE.md`](./CLAUDE.md) — conventions & guardrails for AI coding agents

## Contributing

Contributions are welcome. Please read **[CONTRIBUTING.md](./CONTRIBUTING.md)**
and our **[Code of Conduct](./CODE_OF_CONDUCT.md)**. All contributions are made
under the **[Contributor License Agreement](./CLA.md)**, which keeps the
dual-license model possible.

Found a security issue? See **[SECURITY.md](./SECURITY.md)** — please do not
open a public issue.

## License

Holons is **dual-licensed**:

- **[GNU AGPL-3.0-or-later](./LICENSE.md)** — free and open source for everyone (the default).
- **[Commercial license](./LICENSE-COMMERCIAL.md)** — for organizations that cannot comply with the AGPL.

See **[LICENSING.md](./LICENSING.md)** for which one applies to you and why.

Copyright © Roberto Valenti and the Holons contributors.
IP is held personally by **Roberto Valenti**, who grants an exclusive,
irrevocable license to **Rigenerativa SRL** — the single Licensor, which
publishes Holons under the AGPL and issues the commercial license — see
[LICENSING.md](./LICENSING.md).
