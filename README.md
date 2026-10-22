<div align="center">

# Holons

**One source of truth for holonic coordination — every interface sharing it.**

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
(`@holons/core`), the Holosphere data layer, and the interfaces that all call
into it — a web dashboard, a hub kiosk, WeQuest, Telegram and Discord bots, a
CLI, an AI agent, an MCP server and a voice adapter.

## Why this exists

Most coordination tools lock your group's data inside one app and one company.
Holons is **local-first and federated**: every record is a signed Nostr event
on relays, mirrored into a local event-sourced store (the *Holosphere* layer),
every group ("holon") owns its namespace, and groups federate peer-to-peer
without a central authority. The same domain logic drives a web dashboard, a
hub kiosk, Telegram and Discord bots, a CLI, a natural-language agent, and an
MCP server — so you can meet your community where it already is.

## Architecture

```
   ┌─────────────────────────────────────────────────────────────────────┐
   │                            @holons/core                              │
   │  tasks · scoring · expenses · federation · users · calendar ·        │
   │  library · checklists · shopping · roles · needs · flows · rea ·     │
   │  settings · dna · governance · nostr · shifts · auth · holosphere …  │
   └─────────────────────────────────────────────────────────────────────┘
        ▲          ▲          ▲           ▲           ▲          ▲
   ┌─────────┐ ┌────────┐ ┌─────────┐ ┌──────────┐ ┌─────────┐ ┌──────────┐
   │   web   │ │ kiosk  │ │ wequest │ │ telegram │ │ discord │ │ text·ai· │
   │(Svelte) │ │ (PWA)  │ │ (PWA)   │ │(Telegraf)│ │  bot    │ │mcp·voice │
   └────┬────┘ └───┬────┘ └────┬────┘ └────┬─────┘ └────┬────┘ └────┬─────┘
        └──────────┴───────────┴───────────┴────────────┴───────────┘
                                       │
        Holosphere — signed kind-30078 events on Nostr relays
        (wss://relay.holons.io, wss://relay.commonshub.dev), mirrored
        into a local event-sourced store: IndexedDB · file · memory
```

Core never imports a UI framework; UIs never re-implement domain rules. Full
details in [`docs/architecture.md`](./docs/architecture.md).

## Packages

| Package | Path | What it owns |
| --- | --- | --- |
| `@holons/core` | `packages/core/` | UI-agnostic domain logic (29 domains): tasks, scoring, expenses, federation, users, calendar, library, checklists, shopping, roles, needs, flows, settings, DNA, governance, REA event store (ValueFlows ontology), Nostr projections, Elinor shifts, auth, the one Holosphere factory. |
| `holosphere` | `packages/holosphere/` | The data layer: signed Nostr events (kind 30078) on relays, a local event-sourced store, holograms, federation, H3 geospatial holons. |
| `holons-web` | `apps/web/` | Svelte 5 / SvelteKit web dashboard — the primary UI (maps, governance, federation, expenses). |
| `kiosk` | `apps/kiosk/` | Touch-first hub entrance PWA; one deploy serves every hub on `*.hubs.network`. |
| `wequest` | `apps/wequest/` | WeQuest — mobile-first client of the geolocated needs network. |
| `@holons/telegram-ui` | `packages/telegram-ui/` | Telegraf Telegram bot. Stateful chat interface over `@holons/core`; holds the service signing key. |
| `@holons/discord-ui` | `packages/discord-ui/` | Discord slash-command bot over `@holons/core`. |
| `@holons/text-ui` | `packages/text-ui/` | Framework-agnostic CLI/REPL renderer over `@holons/core/commands`. |
| `@holons/ai-ui` | `packages/ai-ui/` | Natural-language interface: Claude (Anthropic SDK) tool-use loop exposing core actions. |
| `@holons/mcp-ui` | `packages/mcp-ui/` | Model Context Protocol server exposing every core function as a callable tool. |
| `@holons/voice-ui` | `packages/voice-ui/` | Voice adapter: browser mic → STT → LLM → Holons MCP tools → TTS. |

## Quick start

Requires **Node ≥ 20** and **pnpm ≥ 10**.

```bash
git clone https://github.com/HolonicLabs/holons.git
cd holons
pnpm install                 # one workspace install, one lockfile
pnpm -r typecheck            # typecheck every package
pnpm -r build                # build every package (apps consume core's compiled dist)
pnpm test                    # run every package's test suite — no network needed

cp .env.example .env         # ONE root .env serves every app; fill in only what you run
pnpm dev                     # start the web UI  → http://localhost:5173
```

Run any single interface:

```bash
pnpm dev:kiosk                                # hub kiosk → http://localhost:5273/<holon id>
pnpm dev:bot                                  # Telegram bot (BOT_TOKEN, HOLOSPHERE_NSEC)
pnpm dev:discord                              # Discord bot
pnpm -F @holons/text-ui  exec holons --help   # CLI
pnpm -F @holons/ai-ui    exec holons-ai "create a task to fix the roof"  # needs ANTHROPIC_API_KEY
pnpm -F @holons/mcp-ui   start                # MCP server (stdio)
```

Unset relays mean the production relay set; the template's
`HOLONS_APP=HolonsDebug` keeps development writes out of the live namespace.

New here? Start with the **[Tutorial](./TUTORIAL.md)** (run the stack and make
your first change) and the **[Onboarding guide](./ONBOARDING.md)**.

## Documentation

- [`docs/README.md`](./docs/README.md) — documentation index
- [`docs/architecture.md`](./docs/architecture.md) — how the layers and data flow fit
- [`docs/realtime-sync.md`](./docs/realtime-sync.md) — how Holosphere sync works
- [`docs/nostr-onboarding.md`](./docs/nostr-onboarding.md) — Nostr primer, the event scheme, the local store, relay runbook
- [`packages/holosphere/NOSTR-BACKEND.md`](./packages/holosphere/NOSTR-BACKEND.md) · [`STORE.md`](./packages/holosphere/STORE.md) · [`SIGNING.md`](./packages/holosphere/SIGNING.md) — the data layer
- [`docs/shifts-elinor.md`](./docs/shifts-elinor.md) — community shifts shared with Elinor (NIP-52)
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
