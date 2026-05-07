# Holons monorepo

One source of truth for Holons domain logic, four UIs sharing it.

```
harvest/
├── apps/
│   └── web/                  # SvelteKit web UI (was the harvest repo)
└── packages/
    ├── core/                 # @holons/core — UI-agnostic domain logic (TS)
    ├── telegram-ui/          # @holons/telegram-ui — Telegraf bot (was holonsbot)
    ├── text-ui/              # @holons/text-ui — CLI/REPL renderer
    └── ai-ui/                # @holons/ai-ui — Claude tool-use natural-language interface
```

All four UIs read from and write to the same Holosphere namespace and call the same `@holons/core` functions for scoring, tasks, federation, etc. — so "compute user score", "create a task", "publish to federation" mean the exact same thing in every UI.

## Quick start

```bash
pnpm install                                  # workspace install (one lockfile)
pnpm -r typecheck                             # typecheck every package
pnpm -r build                                 # build every package
pnpm dev                                      # start the web UI (apps/web)
pnpm dev:bot                                  # start the telegram bot
pnpm -F @holons/text-ui exec holons --help    # text UI
pnpm -F @holons/ai-ui exec holons-ai "..."    # AI UI (needs ANTHROPIC_API_KEY)
```

Requires Node ≥20 and pnpm ≥10.

## Packages

| Package                | Path                    | What it owns                                                            |
| ---------------------- | ----------------------- | ----------------------------------------------------------------------- |
| `harvest-web`          | `apps/web/`             | SvelteKit web app: components, routes, stores, Mapbox/H3 visuals.       |
| `@holons/core`         | `packages/core/`        | Domain logic — scoring, tasks, federation, holosphere I/O, shopping, settings, DNA, users, expenses, calendar, library, checklists, council, categories, commands. |
| `@holons/telegram-ui`  | `packages/telegram-ui/` | Telegraf bot: scenes, inline keyboards, Puppeteer screenshots. Calls into `@holons/core`. |
| `@holons/text-ui`      | `packages/text-ui/`     | Framework-agnostic CLI/REPL. Calls `@holons/core/commands`.             |
| `@holons/ai-ui`        | `packages/ai-ui/`       | Anthropic SDK tool-use loop exposing `@holons/core/commands` as Claude tools. |

## How the layers fit

```
         ┌─────────────────────────────────────────────────────────┐
         │                    @holons/core                         │
         │  scoring · tasks · federation · holosphere · shopping   │
         │  settings · dna · users · expenses · calendar · library │
         │  checklists · council · categories · commands           │
         └─────────────────────────────────────────────────────────┘
            ▲              ▲              ▲              ▲
            │              │              │              │
       ┌─────────┐   ┌────────────┐  ┌──────────┐  ┌──────────┐
       │ harvest │   │ telegram-  │  │ text-ui  │  │  ai-ui   │
       │  -web   │   │    ui      │  │ (CLI)    │  │ (Claude) │
       └─────────┘   └────────────┘  └──────────┘  └──────────┘
            │              │              │              │
            └──────────────┴──────────────┴──────────────┘
                                 │
                         Holosphere (Nostr+GunDB)
```

## Conventions

- **Subpath imports**: `import { calculateUserScore } from '@holons/core/scoring'` — no central barrel re-exports across domains. Each domain at `packages/core/src/<domain>/index.ts`.
- **TypeScript everywhere** in core + new UIs. The Telegraf bot is in mixed JS+TS state (bootstrap + several modules migrated; rest still JS, allowed via `allowJs`).
- **Svelte stays UI-side**. Core never imports `svelte` or `telegraf` — only types when needed (via `import type`).
- **One Holosphere factory**, in `@holons/core/holosphere`. Every UI calls it for identity-aware writes (`writeWithIdentity`, `canWriteToHolon`).

## Adding a new shared domain

1. Create `packages/core/src/<domain>/{index.ts, ...}.ts`.
2. Export from `index.ts`. No need to touch `packages/core/src/index.ts` — subpath exports cover it via `packages/core/package.json` wildcard.
3. Add a vitest spec in the same directory: `<domain>/<domain>.test.ts`.
4. If the domain needs a new dep, add it to `packages/core/package.json#dependencies`.

## Adding a new UI

1. `mkdir packages/<my-ui>/src && cd packages/<my-ui>`.
2. Copy `packages/text-ui/{package.json,tsconfig.json}` as a starting point. Update `name` and `bin`.
3. Depend on `@holons/core` via `"@holons/core": "workspace:*"`.
4. Run `pnpm install` from the repo root.
5. Implement the renderer/parser/whatever-input-mode against `@holons/core/commands` so all four UIs invoke the same actions.

## License

AGPL — same as harvest before the unification.
