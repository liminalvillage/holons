# Architecture

Holons is a pnpm monorepo with one shared domain layer and several UIs that
all read from and write to the same peer-to-peer data namespace. The guiding
principle: "compute a score", "create a task", "publish to federation" mean
the exact same thing in every UI because they all call the same
`@holons/core` functions.

## Layered model

```
UIs            web · telegram · text · ai · mcp
                          │  (call into)
@holons/core   scoring · tasks · federation · holosphere · users ·
               expenses · calendar · shopping · settings · dna ·
               library · checklists · categories ·
               commands · rea
                          │  (reads/writes through)
Holosphere     identity-aware HoloSphere instance
                          │
Data layer     GunDB peer-to-peer sync (default peer
               https://gun.holons.io/gun; Nostr relay URLs are
               mapped to Gun peers by holosphere)
```

Each layer only depends downward. `@holons/core` never imports `svelte`,
`telegraf`, or any UI framework — only `holosphere` and small utilities.
UIs never reimplement domain logic; they render and collect input.

## Workspace layout

```
harvest/
├── apps/
│   └── web/                # harvest-web — SvelteKit web UI
└── packages/
    ├── core/               # @holons/core — UI-agnostic domain logic (TS)
    ├── telegram-ui/        # @holons/telegram-ui — Telegraf bot
    ├── text-ui/            # @holons/text-ui — CLI/REPL renderer
    ├── ai-ui/              # @holons/ai-ui — Claude tool-use interface
    └── mcp-ui/             # @holons/mcp-ui — MCP server over core
```

`pnpm-workspace.yaml` globs `apps/*` and `packages/*`. One lockfile, Node
≥20, pnpm ≥10. See the [repository root README](../README.md) for build and
run commands.

## What each package owns

| Package | Path | Owns |
| --- | --- | --- |
| `harvest-web` | `apps/web/` | SvelteKit app — routes, components, stores, Mapbox/H3 visuals, splash/identity flow. |
| `@holons/core` | `packages/core/` | All domain logic. Subpath modules under `packages/core/src/<domain>/`. |
| `@holons/telegram-ui` | `packages/telegram-ui/` | Telegraf bot: scenes, inline keyboards, Puppeteer screenshots. |
| `@holons/text-ui` | `packages/text-ui/` | Framework-agnostic CLI/REPL over `@holons/core/commands`. |
| `@holons/ai-ui` | `packages/ai-ui/` | Anthropic SDK tool-use loop exposing core commands as Claude tools. |
| `@holons/mcp-ui` | `packages/mcp-ui/` | MCP server exposing every core function as an independently-callable tool. |

### `@holons/core` domains

The barrel `packages/core/src/index.ts` deliberately re-exports nothing —
consumers import per domain to avoid coupling every UI to every domain:

```ts
import { calculateUserScore } from '@holons/core/scoring';
import { createHoloSphere } from '@holons/core/holosphere';
```

Each domain lives at `packages/core/src/<domain>/index.ts`. Current domains:
`scoring`, `tasks`, `federation`, `holosphere`, `users`, `expenses`,
`calendar`, `shopping`, `settings`, `dna`, `library`, `checklists`,
`categories`, `commands`, `rea`. The `package.json` wildcard
export (`"./*"`) makes a new domain folder importable immediately — no edit
to the barrel needed.

## The Holosphere data layer

`@holons/core/holosphere` is the single place a `HoloSphere` instance is
constructed and the single gate for identity-aware writes. Files:

- `factory.ts` — `createHoloSphere(options)`. UI-agnostic: it never touches
  `process.env`, `localStorage`, or the filesystem. The caller resolves its
  own private key and passes it in. Returns a `HoloSphere` synchronously, or
  a `Promise<HoloSphere>` when `awaitReady: true`. Extra config (including
  Nostr-style `nostr: { relays, peers }`) passes through `extra`.
- `identity.ts` — `canWriteToHolon()` / `resolveActingAs()`. Asks the
  holosphere `canWrite` mixin "may `actingAs` write to `holonId/lens`?",
  falling back to an owner check. Used for UI gating, not security
  enforcement; failures resolve to `false`.
- `write.ts` — `writeWithIdentity()` and `createHolonWriter()`. Wraps
  `holosphere.put`, attaches the current `actingAs` identity, and turns
  authorization errors into a `false` return (with an optional `onDenied`
  callback) while letting non-auth errors bubble.

### Backend reality (holosphere 1.3.0-alpha5)

The pinned `holosphere` is consumed straight from npm (the soft-tombstone,
hologram-resolve-resilience, and bounded-read fixes that used to live in
`patches/holosphere@1.3.0-alpha4.patch` are now upstream as of alpha5).
Under the hood it runs on **GunDB**, not raw Nostr:

- Default Gun peer: `https://gun.holons.io/gun`. In the browser, `radisk`
  persistence is on and `localStorage` is disabled.
- Any `nostr: { relays | peers }` URLs are rewritten to Gun HTTP peers:
  `wss://host` → `https://host/gun` (and `ws://` → `http://`).
- Today's transport is therefore GunDB graph sync; the Nostr config surface
  is a forward-compatibility seam for a future Nostr-relay backend (the web
  app keeps that path commented out in
  `apps/web/src/routes/+layout.svelte`).

### Namespacing and identity

- The app namespace selects the data space. The web app reads
  `import.meta.env.VITE_HOLONS_APP`, falling back to `Holons` (production) /
  `HolonsDebug` (otherwise). `apps/web/src/configuration/config.ts` exposes
  the analogous `Holosphere` / `HolosphereDebug` helper.
- A user's private key (Nostr-style hex) derives their public key, which is
  their personal holon id. Telegram-mapped sessions are namespaced by
  Telegram user id instead.
- Data is addressed as `<appName> → <holonId> → <lens> → <id>`. A "lens" is
  a typed slice of a holon (e.g. `quests`, `expenses`, `settings`, `users`).

## Federation

`@holons/core/federation` is the UI-agnostic federation layer. The native
HoloSphere federation record is the **single store** for links — one read,
one write, shared by every surface (there is no settings-lens mirror; the
legacy `federation[]`/`lensConfig` settings fields were removed):

- `setFederationPartner()` / `removeFederationPartner()` — THE write path:
  link/unlink a partner and set its full directional lens config (which
  lenses flow `inbound`/`outbound`). HoloSphere mirrors the link — and its
  removal — onto the partner's record.
- `getFederationSnapshot()` / `readSettingsHex()` — read federation state.
- `publishToFederation()` — routes an item to `all` federated partners, one
  `partner`, or one `hex` (H3 cell). By default it writes a standalone copy;
  hologram (soul-pointer) publication is opt-in via `useHolograms`.
- `migrateLegacyFederationLinks()` — one-shot, merge-only fold of
  pre-unification settings-lens links into the native record; federation UIs
  call it best-effort before reading the snapshot.

UI-side concerns (Svelte stores, identity resolution, toast notifications)
stay in the UI: callers pass `federationSourceId` and an optional
`onWriteDenied` callback. The web app additionally runs a global federation
DM subscription in its root layout to receive cross-holon
request/response/update messages (see [realtime-sync.md](./realtime-sync.md)).

## Conventions

- Subpath imports only; no cross-domain barrel re-exports.
- TypeScript across core and new UIs. The Telegram bot is mid-migration
  (mixed JS+TS via `allowJs`).
- Svelte/Telegraf stay UI-side. Core imports UI libs only as `import type`.
- One Holosphere factory. Every UI goes through `@holons/core/holosphere`
  for construction and identity-aware writes.

To add a domain: create `packages/core/src/<domain>/{index.ts,*.test.ts}`,
export from its `index.ts`, add any new dependency to
`packages/core/package.json`. No barrel edit required.
