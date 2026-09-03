# Architecture

Holons is a pnpm monorepo with one shared domain layer and several UIs that
all read from and write to the same relay-synced data namespace. The guiding
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
Data layer     signed Nostr events (kind 30078) on relays
               (wss://relay.holons.io, wss://relay.commonshub.dev)
               mirrored into a local event-sourced store
```

Each layer only depends downward. `@holons/core` never imports `svelte`,
`telegraf`, or any UI framework — only `holosphere` and small utilities.
UIs never reimplement domain logic; they render and collect input.

## Workspace layout

```
holons/
├── apps/
│   └── web/                # holons-web — SvelteKit web UI
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
| `holons-web` | `apps/web/` | SvelteKit app — routes, components, stores, Mapbox/H3 visuals, splash/identity flow. |
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
  a `Promise<HoloSphere>` when `awaitReady: true`. Takes `relays`, `store`
  (`memory` | `indexeddb` | `file`), `signing` and `nostr` (projections);
  anything else passes through `extra`.
- `relays.ts` — `DEFAULT_RELAYS` and `resolveRelays(env)`: the one place the
  production relay set lives. Every write is signed by the instance key and
  published; there is no signing mode to configure.
- `identity.ts` — `canWriteToHolon()` / `resolveActingAs()`. Asks the
  holosphere `canWrite` mixin "may `actingAs` write to `holonId/lens`?",
  falling back to an owner check. Used for UI gating, not security
  enforcement; failures resolve to `false`.
- `write.ts` — `writeWithIdentity()` and `createHolonWriter()`. Wraps
  `holosphere.put`, attaches the current `actingAs` identity, and turns
  authorization errors into a `false` return (with an optional `onDenied`
  callback) while letting non-auth errors bubble.

### Data layer reality (holosphere 2.x)

The workspace `holosphere` package has no network library of its own: the
**Nostr relays are the wire** and a **local event-sourced store** is the
cache (`packages/holosphere/STORE.md`).

- Every non-private `put`/`delete` is a signed kind-30078 event (NIP-33
  replaceable per `holon/lens/id`, tagged with the app namespace) published
  to the configured relays. Deletes are signed tombstones.
- Every `get`/`getAll`/`subscribe` syncs its `(holon, lens)` from the relays
  once (paginated backfill, then a cursor) and serves reads from the store;
  a live REQ keeps the store current. One last-writer-wins rule: newer
  `created_at` wins, ties go to the larger event id.
- The store persists in IndexedDB in browsers, a JSONL log + snapshot on
  long-lived Node hosts (`store: { adapter: 'file', dir }`), and memory in
  serverless functions and scripts. Reloads paint from the store and catch
  up from the cursor.
- Every record is ALSO published as its standard Nostr kind (NIP-52 events,
  NIP-99 classifieds, kind-0 profiles, NIP-51 sets, NIP-58 badges, NIP-29
  group metadata) by default — `projectionOptionsFor` in `@holons/core/nostr`
  — and external edits of those kinds fold back into the record.
- Private (password) lenses are NIP-44 encrypted with a scrypt-derived key
  and never leave the device.
- Configure per surface: web `VITE_HOLOSPHERE_RELAYS`,
  kiosk `VITE_KIOSK_RELAYS`, bot/mcp `HOLOSPHERE_RELAYS` +
  `HOLOSPHERE_STORE_DIR`. Unset relays mean the production relay set.

### Namespacing and identity

- The app namespace selects the data space. The web app reads
  `import.meta.env.VITE_HOLONS_APP`, falling back to `Holons` (production) /
  `HolonsDebug` (otherwise). `apps/web/src/configuration/config.ts` exposes
  the analogous `Holosphere` / `HolosphereDebug` helper.
- A user's private key (Nostr-style hex) derives their public key, which is
  their personal holon id. Telegram sessions are namespaced by Telegram user
  id instead (they sign with a per-user key derived server-side).
- Sign-in (web, `@holons/core/auth`): every provider ends in a Nostr keypair
  the HoloSphere signing layer can use — Telegram (suggested; OIDC + a
  server-derived key), a **passkey** (WebAuthn PRF output → key, no server
  store; bound to the `rpId` hostname, so localhost and production yield
  different identities), the user's **own Nostr key** (nsec import or a new
  key with a one-time backup), or an **Ethereum wallet** (deterministic
  `personal_sign` of the frozen `ETH_IDENTITY_MESSAGE` → key; injected
  wallets only). Key-based identities prove ownership to the web server with
  a NIP-98 event (`POST /api/auth/key`) and share the same session cookie.
  The derivation constants in `packages/core/src/auth/derive.ts` are frozen:
  changing one rotates every user's identity.
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
