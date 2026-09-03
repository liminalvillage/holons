# Onboarding

Welcome to **Holons**. This page gets a new contributor productive in about 30
minutes. For the conceptual picture read [`README.md`](./README.md) and
[`docs/architecture.md`](./docs/architecture.md) first; for a hands-on first
change, follow the [`TUTORIAL.md`](./TUTORIAL.md); for the Nostr side (keys,
events, relays, the local store) read
[`docs/nostr-onboarding.md`](./docs/nostr-onboarding.md).

## 1. The two ideas to internalize

**One source of truth for behavior**: `@holons/core`. Every interface (web
dashboard, hub kiosk, WeQuest, Telegram and Discord bots, CLI, AI agent, MCP
server, voice) is a thin renderer over it. If you change *what an action
means*, change it in `@holons/core` and every UI inherits it. If you change
*how it looks*, change it in the UI only. Never duplicate domain logic into a
UI.

**The relays are the wire.** Data lives in **Holosphere**
(`packages/holosphere`): every record is a signed Nostr event (kind 30078,
addressable per holon/lens/id) published to the production relays
(`wss://relay.holons.io`, `wss://relay.commonshub.dev`) and mirrored into a
local event-sourced store — IndexedDB in browsers, a file log on the bot,
memory in serverless functions and scripts. Reads answer from the store, one
live subscription per `(holon, lens)` keeps it current, and every record is
also published as its standard Nostr kind (calendar, classified, profile, list,
badge, group) so other Nostr clients can read it. There is no central server
of record; every group ("holon") owns its namespace. Details:
[`packages/holosphere/NOSTR-BACKEND.md`](./packages/holosphere/NOSTR-BACKEND.md),
[`STORE.md`](./packages/holosphere/STORE.md),
[`SIGNING.md`](./packages/holosphere/SIGNING.md).

## 2. Environment

| Requirement | Version                                                                  |
| ----------- | ------------------------------------------------------------------------ |
| Node        | ≥ 20 for the workspace; ≥ 22 on a bot host (nostr-tools needs `WebSocket`) |
| pnpm        | ≥ 10 (`corepack enable`)                                                 |
| OS          | macOS / Linux / WSL                                                      |

```bash
git clone https://github.com/HolonicLabs/holons.git
cd holons
pnpm install
pnpm -r typecheck && pnpm test     # should be green on a clean clone
```

Tests never touch the network: Holosphere suites run on an in-memory store
with an in-process relay when a wire is needed.

## 3. Repository map

```
apps/web/               holons-web — Svelte 5 dashboard (primary UI)
apps/kiosk/             hub entrance kiosk PWA, multi-tenant on *.hubs.network
apps/wequest/           WeQuest — mobile-first client of the needs network
packages/core/          @holons/core — all domain logic (start here)
packages/holosphere/    the data layer: signed events on relays + local store
packages/telegram-ui/   Telegraf bot (holds the service signing key)
packages/discord-ui/    Discord slash-command bot
packages/text-ui/       CLI / REPL
packages/ai-ui/         Claude tool-use natural-language interface
packages/mcp-ui/        Model Context Protocol server
packages/voice-ui/      voice adapter (mic → STT → LLM → MCP tools → TTS)
docs/                   architecture, realtime-sync, nostr onboarding, shifts, user guide
```

`packages/core/src/<domain>/` holds the 29 domains (tasks, scoring, expenses,
federation, users, calendar, library, nostr, shifts, auth, holosphere, …). Each
is reached via a subpath import: `import { ... } from '@holons/core/<domain>'`.
Apps consume core's **compiled `dist`**: run `pnpm -F @holons/core build` after
changing core or the running app keeps the old code while tests stay green.

## 4. Run what you'll touch

One root `.env` serves every app and package (the SvelteKit apps read it from
the repo root). Copy the template and fill in only the keys you need; the
contract, grouped by consumer, is documented inline:

```bash
cp .env.example .env
pnpm dev                                   # web dashboard → http://localhost:5173
pnpm dev:kiosk                             # kiosk → http://localhost:5273/<holon id>
pnpm dev:bot                               # Telegram bot (needs BOT_TOKEN, HOLOSPHERE_NSEC)
pnpm dev:discord                           # Discord bot
pnpm -F @holons/text-ui exec holons --help # CLI
pnpm -F @holons/mcp-ui start               # MCP server (stdio)
```

Unset relays mean the production relay set; `HOLONS_APP=HolonsDebug` (the
template default) keeps development writes out of the live `Holons`
namespace. Nostr secrets are `*_NSEC` variables holding `nsec1…`; nothing
secret ever gets a `VITE_` prefix (those ship in browser bundles).

Secrets (`.env`, `.mcp.json`) are gitignored — never commit them. If one
leaks, rotate it.

## 5. Your first contribution

1. Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) and the
   [`CLA.md`](./CLA.md) (accepted via signed-off commits / CLA check).
2. Branch from `dev`: `feat/<topic>` or `fix/<topic>`.
3. Make the change in `@holons/core` (with a `vitest` spec next to it) before
   any UI work. Holosphere changes ship a jest spec built on
   `packages/holosphere/test/helpers/testenv.js`.
4. `pnpm -r typecheck && pnpm test && pnpm lint` must pass.
5. Commit with `git commit -s` (Conventional Commits, scoped: `core/tasks: …`,
   `kiosk: …`, `holosphere/store: …`). New source files carry the SPDX header
   `AGPL-3.0-or-later`.
6. Open a PR against `dev` using the template.

The [`TUTORIAL.md`](./TUTORIAL.md) walks through exactly this with a concrete
example.

## 6. Where to get unstuck

- **Architecture/data flow:** [`docs/architecture.md`](./docs/architecture.md)
- **Sync behavior:** [`docs/realtime-sync.md`](./docs/realtime-sync.md)
- **Nostr, keys, relays, the store:** [`docs/nostr-onboarding.md`](./docs/nostr-onboarding.md)
  and the three Holosphere docs above
- **Elinor shifts interop:** [`docs/shifts-elinor.md`](./docs/shifts-elinor.md)
- **AI-agent conventions & guardrails:** [`CLAUDE.md`](./CLAUDE.md)
- **A package's specifics:** that package's `README.md`
- **Security concerns:** [`SECURITY.md`](./SECURITY.md) (never a public issue)

Open a draft PR or discussion early — questions are welcome.
