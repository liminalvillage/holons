# Holons handoff — the Commons Hub site first, Nostr second

Written 2026-09-03. This is the whole briefing for joining Holons work.

**The plan, in order**

1. **Now — the Commons Hub site.** Work on the Commons Hub instance of the
   Holons web app (the kiosk at `commons.hubs.network`), specifically its
   back end and its data storage, which run on Nostr. Use the existing relay
   (`wss://relay.holons.io`); change only the website and the storage code.
2. **Later — Nostr itself.** Relay work, including a community relay on a
   Raspberry Pi 4B. The runbook is in Appendix A so nothing is lost, but it
   is not the first step.

Read sections 1–3 top to bottom once; sections 4–6 are the working reference.

---

## 1. Nostr in one page (the primer)

Nostr = "Notes and Other Stuff Transmitted by Relays". Not a blockchain, not a
P2P mesh. Three things:

1. **Keys.** Every actor is a secp256k1 keypair. The public key (32 bytes,
   64 hex chars) is the identity; the private key signs. Bech32 forms
   `npub1…` / `nsec1…` (NIP-19) are display encodings of the same hex.
   Relays and code work in hex.
2. **Events.** The one data structure. Signed JSON, self-verifying:

   ```json
   {
     "id":         "<sha256 of [0,pubkey,created_at,kind,tags,content]>",
     "pubkey":     "<64 hex>",
     "created_at": 1756900000,
     "kind":       30078,
     "tags":       [["h","-5459621960"],["l","quests"],["d","…"],["n","Holons"]],
     "content":    "<any string; Holons puts JSON here>",
     "sig":        "<schnorr signature over id>"
   }
   ```
   Anyone can verify `sig` against `pubkey`; nobody can forge or alter an
   event. Tags are arrays of strings; element 0 is the tag name. Relays index
   **single-letter** tag names only (`e`, `p`, `d`, `h`, …).
3. **Relays.** Dumb WebSocket servers that store events and answer queries.
   They never hold keys, so they can serve or withhold but never forge.
   Clients talk to several relays at once.

**Wire protocol (NIP-01)** — JSON arrays over one WebSocket:

| direction | message | meaning |
|---|---|---|
| client → relay | `["EVENT", event]` | publish |
| client → relay | `["REQ", subId, filter, …]` | query, then stay subscribed |
| client → relay | `["CLOSE", subId]` | stop a subscription |
| relay → client | `["EVENT", subId, event]` | a match (stored or live) |
| relay → client | `["EOSE", subId]` | end of stored events; live ones follow |
| relay → client | `["OK", eventId, true/false, msg]` | publish accepted / rejected |
| relay → client | `["CLOSED", subId, msg]`, `["NOTICE", msg]` | relay ended the sub / info |

**Filters** (fields AND together; several filters in one REQ OR together):
`ids`, `authors`, `kinds`, `#<letter>`, `since`, `until`, `limit`.
Example: `{"kinds":[30078],"#h":["-5459621960"],"#l":["quests"],"#n":["Holons"]}`.

**Kind ranges** decide how relays store an event:

| range | name | storage rule |
|---|---|---|
| 1, 2, 4–44, 1000–9999 | regular | every event kept |
| 0, 3, 10000–19999 | replaceable | newest per `(pubkey, kind)` |
| 20000–29999 | ephemeral | not stored |
| 30000–39999 | addressable (older name: NIP-33 parameterized replaceable) | newest per `(pubkey, kind, d-tag)` |

Newer `created_at` wins; on a tie the lexically lowest `id` is kept. An
addressable event is referenced by its **address** `kind:pubkey:d` in an `a`
tag. Deletion requests are kind 5 (NIP-09) and are advisory.

**NIPs you will meet here** (spec repo: https://github.com/nostr-protocol/nips):

| NIP | what | used by Holons for |
|---|---|---|
| 01 | events, filters, relay protocol | everything |
| 09 | kind-5 deletion | retracting projected standard events |
| 11 | relay information document (`Accept: application/nostr+json` on the https URL) | relay identity / limits |
| 17 + 59 + 44 | private DMs (gift wrap + seal + encryption); 44 alone also encrypts private lenses | federation handshake DMs, bot notifications, password lenses |
| 19 | bech32 `npub`/`nsec`/`naddr` | login UI (nsec import) |
| 25 | reactions (kind 7) | "appreciation" on quests |
| 29 | relay-based groups (39000–39002, 9000–9021) | a holon published as a group |
| 42 | client authentication (AUTH) | **not implemented in our client — a relay must not require it** |
| 51 | lists/sets (30003) | checklists, shopping, library |
| 52 | calendar events (31922/31923) + RSVP (31925) | quests/events, Elinor shifts |
| 58 | badges (30009 definition, 8 award) | roles |
| 98 | HTTP auth via signed event | web login with an own key |
| 99 | classifieds (30402) | offers / needs |
| (app-specific) | kind 30078 | **the canonical Holons record** |

**Tooling**
- `nak` — CLI for events/relays (https://github.com/fiatjaf/nak):
  `nak req -k 30078 -t h=-5459621960 -t n=Holons wss://relay.holons.io`
- `nostr-tools` — the JS library the repo uses (`nostr-tools/pure`, `SimplePool`).
- strfry — the relay software behind `relay.holons.io` (https://github.com/hoytech/strfry).
- Elinor docs, the shifts format we interoperate with: https://elinor.commonshub.dev/docs

---

## 2. How Holons stores data on Nostr

### 2.1 Vocabulary
- **Holon** — a group. Its id is the Telegram chat id (Commons Hub:
  `-5459621960`) or, for key-based identities, the user's pubkey hex.
- **Lens** — a named collection inside a holon: `quests`, `users`, `offers`,
  `checklists`, `shopping`, `library`, `roles`, `settings`, `events`, …
- **Record / item** — a JSON object with an `id` inside a lens.
- **Holosphere** — the data library (`packages/holosphere`, plain JS). The
  API is `put / get / getAll / delete / subscribe(holon, lens, …)`.
- **Hologram** — a mirror pointer of a record into another holon (federation).
- **App namespace** — `Holons` (production) vs `HolonsDebug` share one relay
  without mixing; carried in the `n` tag. The kiosk reads `Holons` by default.

### 2.2 The wire record: kind 30078
Every non-private `put` becomes one signed addressable event:

```
kind 30078
content = JSON(item)
tags    = [["h", holon | "_g"], ["l", lens], ["d", "holon/lens/id"], ["n", appName]]
```

- Sync REQs use exactly three tag filters `#h`, `#l`, `#n`; a relay must allow
  ≥ 3 tag filters per filter (strfry default is 3).
- `_g` in `h` marks holon-less "global" records.
- A **delete** is not kind 5: it is a new 30078 whose content is the tombstone
  `{ "id": …, "_deleted": true }`. Readers filter tombstones out.
- **Conflicts**: last-writer-wins on `created_at` (seconds). The client keeps
  `created_at` strictly increasing per address so rapid re-puts are not
  rejected as "older".
- **Private (password) lenses never touch the relay.** Encrypted with NIP-44,
  they stay on the device.

"The relay is the wire" (`backend: 'nostr'`): writes publish to the relay(s),
reads catch up per `(holon, lens)` with one REQ that resolves at EOSE and then
stays open, every ingested event is signature-verified. Relay loss ≠ data loss:
any client can republish its own events; moving relays is a verbatim copy.

Relays in use: `wss://relay.holons.io` (primary, strfry) and
`wss://relay.commonshub.dev` (Elinor / Commons Hub shifts). A legacy Gun peer
(`https://gun.holons.io/gun`) still holds pre-Nostr data, read-only, shown in
the apps behind a "show all data" affordance and never trusted for ownership.

### 2.3 Local storage: today, and where it is going
**Today (shipped):** on the nostr backend, Gun (a graph database) runs
*peerless* as the local cache. Signed events coming from the relay are written
into the local graph, which fires the existing subscription machinery. Signed
envelopes also sit in an `_events` sidecar the signing layer reads for
authorized (`enforce`) reads. Browser cache is `localStorage` (~5 MB ceiling).

**In progress (branch `remove-gun`):** Gun is being replaced by a standalone
**event-sourced local store** — a mirror of the relays. Phase 1 (the store
itself, with memory, IndexedDB and file adapters) is committed; phase 2
(wiring `holosphere.js`/`content.js` onto it and deleting the Gun paths) is
uncommitted work in the same branch. This is the storage work step 1 touches.
From `packages/holosphere/STORE.md`:

```
                 signed kind-30078 events
   relays  ◄──────────────────────────────►  relay-transport.js
                                                    │ store.apply(event)
                                                    ▼
                                   ┌──────────── store ────────────┐
   put/get/getAll/subscribe ◄────► │ records  events  backlinks    │
   (content.js, signing.js)        │ private  cursors  watch feed  │
                                   └───────────────┬───────────────┘
                                                   │ ops
                                                   ▼
                                        adapter: memory | indexeddb | file
```

| table | key | value | durable |
|---|---|---|---|
| `records` | `holon\|lens\|id` (`_g` for globals) | `{ item, created_at, pubkey, eventId, origin }` — the CURRENT value at every address; tombstones kept | yes |
| `events` | event id | the signed envelope; only each author's latest claim per address (NIP-33). Replaces the `_events` sidecar | yes |
| `private` | `scope\|lens\|key` | NIP-44 ciphertext of password lenses | yes |
| `cursors` | `holon\|lens` | `{ since, syncedAt }` — how far the lens is synced | yes |
| `backlinks` | source soul | set of hologram-pointer souls | derived, rebuilt on open |

- **One ordering rule** (`store/lww.js`): `store.apply(event)` is the only
  place "which write is current" is decided. Newer `created_at` wins; on a tie
  the larger event id; unsigned local writes lose ties to signed events.
  Re-applying a known event id is a no-op, so relay echoes need no dedup set.
  Local writes always become current because `nextCreatedAt` bumps one second
  past whatever is current when the clock has not moved.
- **Versions are linear per author and address**: each author's newest claim
  per `(kind, pubkey, d)` is kept; the record table holds the winner across
  authors. History beyond that lives on the relay (addressable kinds keep
  only the newest there too).
- **Change feed**: `store.watch(holon, lens, cb)` replays current non-tombstone
  records on a microtask, then one call per accepted change, tombstones
  included with `meta.tombstone`. Every subscriber gets its own full replay —
  this fixes Gun's "first subscriber only" replay behaviour (see 5).
- **Private lenses**: key = `scrypt(password, "<app>:<holon|lens>", N=2^15, r=8,
  p=1, 32 bytes)`, payload `nip44.v2.encrypt(JSON(item), key)`. Never signed,
  published, propagated, indexed or exported. **KDF parameters are frozen.**
- **Adapters**: `memory` (tests, serverless, scripts), `indexeddb`
  (browsers: DB `holosphere:<app>`, one read-write transaction per batch,
  quota errors degrade to memory-only), `file` (Node: snapshot JSON + JSONL
  log, compacted on open and after 50 000 ops). `createStore({ appName,
  adapter: 'auto' })` picks IndexedDB when present.
- **Sync cursors**: the relay transport records per `(holon, lens)` the newest
  `created_at` fully caught up. Cold store: paginated `limit`/`until`
  backfill (strfry caps 500 per filter). Warm store: `since: cursor − 60 s`
  then a live subscription. Cursors are set only by the transport after a
  complete backfill, so a crash mid-backfill cannot skip history.

```ts
interface StoreAdapter {
  open(): Promise<Snapshot | null>;   // { records[], events[], private[], cursors[] }
  append(ops: Op[]): Promise<void>;   // rec | evt | evt-del | priv | priv-del | cur
  snapshot(full: Snapshot): Promise<void>;
  clear(): Promise<void>;
  close(): Promise<void>;
}
```

### 2.4 Projections: standard kinds next to 30078
30078 is opaque to other Nostr apps, so per lens each write is *also*
published as the standard kind and each delete as a kind-5 retraction:

| lens | standard kind | notes |
|---|---|---|
| `quests`, `events` | 31923 / 31922 (NIP-52) + one 31925 RSVP per participant | undated quests skipped; `type:'need'` → 30402 |
| `offers` | 30402 (NIP-99) | `status active|sold`, `g` geohash from the H3 hex |
| `users` | 0 (profile) | signed by the USER's key only, never the holon's |
| `checklists`, `shopping`, `library` | 30003 (NIP-51 set) | entries as `['item', …]` tags |
| `appreciation[]` on quests/events | 7 (NIP-25) per appreciator | `+` gives, `-` withdraws |
| `roles` | 30009 badge definition + kind 8 award (NIP-58) | holon-signed |
| `settings` | 39000 metadata + 39001 admins (NIP-29) | holon-signed |
| `users` membership | 9000 / 9021 on join, 9001 on leave, 39002 members | the holon acts as the "group relay" |

Every projected event carries `['n', app]`, `['h', holon]`,
`['t', 'group-<holon>']` (Elinor's grammar), `['holons', lens, holon, id]`
(origin pointer), `['client','holons']`, and for addressable kinds
`d = holons:<lens>:<holon>:<id>`.

**Reverse sync** folds external edits of those kinds back: a calendar app
moving a 31923, an Elinor RSVP, a market client closing a 30402, a member
editing kind 0. Only *trusted* pubkeys (holon key, members' derived keys,
extras from settings) may claim anything; the claim is merged by the lens
codec and re-written as our own 30078 without re-projecting it. Foreign
records are never imported; 30078 stays canonical.

### 2.5 Keys and signing — who signs what
| identity | held where | signs |
|---|---|---|
| holon key | bot server (per app instance) | 30078 records, holon-level projections |
| member key | derived server-side from the Telegram identity + a server secret (deterministic; changing the secret changes every key) | kind 0, RSVPs, reactions, join requests, Elinor signups |
| identity-provider key | derived, service-level | kind-31926 attestations linking one person's several keys |
| kiosk device key | the browser's localStorage, generated once | the kiosk's own writes; the logged-in user is recorded as `actingAs` |
| browser own key | user's device (nsec import, passkey, Ethereum wallet → all end in a Nostr keypair) | the user's writes from web/kiosk when they log in with a key |

Rule: **UIs never hold raw keys.** Code receives a `NostrSigner` (`pubkey` +
`sign(template)`) from `@holons/core/holosphere`; the key stays in a closure.

### 2.6 Elinor shifts (NIP-52 interop) — the one feed that bypasses Holosphere
Community shifts are NIP-52 events shared with Elinor clients on
`relay.commonshub.dev`: 31923 occurrences by a coordinator
(`d = shift-<groupId>-<date>-<code>`), 31925 signups by participants
(`d = rsvp-…`, `a` → the occurrence, `status accepted|declined`), and 31926
identity attestations (`d = telegram:<id>`, one `p` per linked key). A person
may act through several keys; the newest RSVP across all their keys wins.
Rules live in `@holons/core/shifts`; the kiosk Shifts tab holds one live relay
subscription and only renders. `groupId` is the holon id.

---

## 3. The Commons Hub site — what you will work on first

### 3.1 What it is
`apps/kiosk` — a touch-first SvelteKit PWA for the entrance of a hub. One
vertical screen with tabs (Calendar, Tasks, Library, Lists, Roles, Shifts,
Flows, Status, a dock map), auto-rotating unless someone is interacting.
Read-only for visitors; editing after login (Telegram, passkey, own Nostr key
or Ethereum wallet). It reuses the shared Holosphere factory and the core
domain helpers and re-implements **no domain rules** — core owns meaning.

**Multi-tenant:** one Netlify deploy serves every hub. A wildcard domain
`*.hubs.network` points at the one site; the app reads the host's subdomain
and maps it to a holon in `apps/kiosk/src/lib/holons.ts`:

```ts
export const SUBDOMAIN_HOLONS: Record<string, string> = {
  …
  commons: "-5459621960",   // commons.hubs.network
  valley:  "-5459621960",   // valley.hubs.network — same holon
};
```
An unregistered subdomain is read as the holon id itself
(`1003864542239.hubs.network` → `-1003864542239`, sign restored). Resolution
order for the holon: `?holon=<id>` → URL path `/<id|label>` → subdomain →
Settings/localStorage → build-time default. The app namespace resolves
`?app=` → Settings → build-time default → `Holons`.

### 3.2 How the site talks to Nostr (the "back end")
There is no application server holding data. The browser *is* the client:

```
browser (kiosk)                                     relay.holons.io (strfry)
 ├─ holosphere.ts  getHolosphere()  ── createHoloSphere({ backend:'nostr', nostr:{relays} }) ──►  REQ/EVENT (30078)
 │     device key (localStorage) signs; actingAs = logged-in user
 ├─ subscribeLens(hs, holon, lens, cb)  ◄── live records per lens (quests, library, checklists, roles …)
 ├─ getWriter(holon).put(lens, item)     ──► signed 30078 (+ projections when configured)
 ├─ shifts.ts  subscribeSchedule()      ◄── 31923/31925/31926 directly from relay.commonshub.dev
 └─ /api/* (Netlify functions, apps/kiosk/src/routes/api)
        auth/telegram/*, auth/key (NIP-98), auth/session   → JWT session cookie scoped to .hubs.network
        shifts/rsvp                                        → signs an Elinor RSVP server-side as the member
        quest/refresh, image, avatar, opencollective, ai/* → thin proxies (bot API, Telegram files, OpenAI)
```

Key files (all under `apps/kiosk/src/lib/`):
- `holosphere.ts` — builds the one Holosphere instance through the core
  factory; device key; `subscribeLens` (accumulates a lens into a Map keyed by
  id, `null`/`_deleted` = removal); `getWriter` (identity-aware writes with
  `actingAs`, resolves `false` on denial); `getLibraryDb`, `getChecklistStore`,
  `getReaStore` adapters so core's borrow/return, checklist CRUD and REA
  completion own their meaning; `announceWrite` feeds a write-echo watchdog.
- `config.ts` — the resolution order above; backend and relay selection
  (`resolveBackend()` returns `"nostr"` only when a relay list is configured,
  otherwise it stays on the legacy Gun peer); signing mode; shift relays.
- `data.ts` — view-model shaping only (colours, tilts, grouping); every rule
  it calls comes from `@holons/core/tasks|library|checklists|datetime`.
- `stores.ts`, `scope.ts`, `personal.ts`, `membership.ts` — Svelte stores and
  the Show pill (Personal / Local / Global, the last via Holosphere's
  `subscribeFederated`, which stamps partner items with `_federation`).
- `shifts.ts` — the Elinor feed (2.6). `sessionKey.ts` + `login/` — keys.
- `routes/[[holon]]/[[tab]]/+page.svelte` + `+layout.svelte` — the board.
- `holons.ts` — tenant registry + `parseHolonRef` (spec'd in `holons.test.ts`).

Configuration lives in the monorepo-root env file; the kiosk-scoped
variables (holon, app namespace, backend, relays, signing, bot username,
shift relays) are documented in `apps/kiosk/README.md → Configuration` and in
the header of `apps/kiosk/netlify.toml`. The kiosk reads **production**
(`Holons`) by default, independent of the dev namespace the web/bot use.

### 3.3 Develop and deploy
```bash
pnpm install
pnpm -F @holons/core build        # apps consume core's compiled dist — rebuild after any core change
pnpm -F kiosk dev                 # http://localhost:5273  → open /commons or /-5459621960
pnpm -F kiosk build && pnpm -F kiosk preview
pnpm -r typecheck && pnpm test && pnpm lint     # the gate before "done"
```
In dev the instance is exposed as `window.__kiosk` for poking from the console.

Deploy: Netlify, base directory `apps/kiosk`, build runs from the monorepo
root and builds core first (see `netlify.toml`; Node 24 because the functions
need a global `WebSocket` for nostr-tools; explicit `[functions] directory`
so SSR functions deploy). Some hub sites build from the fork
`Valley-of-the-Commons/holons` rather than the main remote — push the branch
there too or the screens never update. Telegram login domain is
`hubs.network` (one BotFather `/setdomain` covers every subdomain); each
tenant's callback URL is registered in BotFather Web Login.

---

## 4. Repo map and interfaces for the Nostr code

Monorepo (pnpm). One rule above all: **core owns meaning, UIs only render.**

```
apps/kiosk/                     the hub site (3.)
apps/web/                       full dashboard (SvelteKit)      apps/wequest/  quest-sharing site
packages/core/src/nostr/        codecs lens ⇄ standard kind, tags, registry, NIP-29 groups, NIP-17 DM helpers
packages/core/src/shifts/       Elinor NIP-52 rules + relay client + 31926 attestations
packages/core/src/auth/         key derivation, NIP-98, provider-agnostic identity
packages/core/src/holosphere/   the ONE Holosphere factory, HolonWriter, NostrSigner / identity context, relay backup
packages/holosphere/            the data library (plain JS):
   nostr-events.js              build / sign / verify 30078 (nostr-tools)
   relay-transport.js           relay as the wire: publish, per-(holon,lens) REQ, ingest + verify
   projections.js, reverse-sync.js, nostr-dm.js (NIP-17)
   store/                       the event-sourced local store (2.3) — index.js, store.js, lww.js, private.js, adapters/
   spike/                       mini-relay.js (in-process NIP-01 relay for tests), strfry.conf, run-strfry.sh
   NOSTR-BACKEND.md  SIGNING.md  STORE.md   ← the authoritative docs; read all three
docs/shifts-elinor.md  docs/architecture.md
packages/telegram-ui/           the bot (holon key lives here; authority for member RSVPs)
```

### 4.1 Codec interface (`packages/core/src/nostr/types.ts`, abridged)
```ts
export interface LensCodec<T = Record<string, unknown>> {
  lens: string;
  kinds: number[];                       // every kind this codec may emit
  requiresAuthor?: 'user';               // kind 0: must be signed by the record's own user key
  project(holon: string, item: T, ctx: ProjectionCtx): Projected | null;   // null = nothing to publish
  retract(holon: string, id: string, ctx: ProjectionCtx): EventTemplate[]; // kind-5 templates
  parse?(event: NostrEventLike, ctx: ProjectionCtx): Reversed<T> | null;   // external event → claim
  merge?(current: T, reversed: Reversed<T>, ctx: ProjectionCtx): T | null; // pure fold, only carried fields
  primary?: '30078' | 'standard';        // always '30078' today
}
export interface Projected { primary: EventTemplate; companions?: Companion[] }
export interface Companion {
  template: EventTemplate;
  authorHint?: { userId: string | number } | { role: 'provider' }; // absent → holon key
  dedupe?: { key: string; state: string }; // non-replaceable kinds: publish only when state changed
}
export interface ProjectionCtx {
  appName: string; holonPubkey: string; now?: () => number;
  timezoneFor?: (holon: string) => string | undefined;
  cellToLatLng?: (h3: string) => [number, number];      // injected; core stays dependency-free
  pubkeyFor?: (userId: string | number) => string | undefined;
  userIdFor?: (pubkey: string) => string | number | undefined;
  providerPubkey?: string;
}
```
Codecs register in `PROJECTION_CODECS` (`projections.ts`); the holosphere host
consumes them as framework-free hooks via `buildProjections`. Tag helpers
(`projectionDTag`, `projectionAddress`, `groupTag`, `commonTags`,
`geohashFromH3`, `isoToUnix`) are in `tags.ts`.

### 4.2 Signing and writing helpers (`packages/core/src/holosphere/`)
```ts
export interface NostrSigner { readonly pubkey: string; sign(template: SignableTemplate): Event }
export function signerFromSecretKey(hex: string): NostrSigner
export interface IdentityContext {
  memberSigner(telegramId): NostrSigner | null;  memberPubkey(telegramId): string | null;
  providerSigner(): NostrSigner | null;          providerPubkey(): string | null;
}
export function createIdentityContext({ derivationSecret }): IdentityContext  // all null when no secret
export function createHoloSphere(opts): HoloSphere            // the only allowed constructor call
export function createHolonWriter(hs, holonId, { actingAs, onDenied }): HolonWriter
export function enableRelayBackup(hs, { relays, mode, backend })   // no-op on the nostr backend
```

### 4.3 Working rules (from CLAUDE.md, non-negotiable)
1. Behaviour changes go in `@holons/core/<domain>`; never re-implement rules in a UI.
2. No UI imports in core (type-only imports are fine).
3. Subpath imports only: `import { x } from '@holons/core/nostr'`.
4. All identity-aware I/O goes through the one Holosphere factory in
   `@holons/core/holosphere`; never `new HoloSphere()` in a UI.
5. Test-first: every core change ships a vitest spec next to it
   (`nostr.test.ts`, `reverse.test.ts`, `shifts.test.ts` are the models).
   Holosphere uses jest; `test/nostr-backend.test.js` runs two peerless
   instances against the in-process relay; store tests use `fake-indexeddb`.
   All holosphere tests must be isolated through `test/helpers/testenv.js`
   (they once hit the production relay).
6. Never commit secrets; if one leaks, rotate it.
7. Before "done": `pnpm -r typecheck && pnpm test && pnpm lint` from a clean
   tree. Sign off commits (`git commit -s`). Conventional Commits with scope
   (`kiosk: …`, `holosphere/store: …`, `core/nostr: …`). New files get the
   SPDX header `AGPL-3.0-or-later`.

---

## 5. Gotchas already paid for
- `@holons/core` subpath imports resolve to `dist/`; rebuild core after
  changes or the running app keeps stale code while tests stay green.
- nostr-tools needs a global `WebSocket`: Node ≥ 22 everywhere, lambdas too.
- Gun (today's cache) replays a lens's existing records to the **first**
  subscriber only; a later subscription on the same cell hears nothing until
  a fresh write. Gun also leaks graph metadata through `subscribe`; filter
  with `looksLikeRecord`. Both go away with the store (2.3).
- Cold reads race the relay; never force synchronous reads. Everything is
  eventually consistent. Clean up every subscription and timer.
- Relays cap one response (strfry: 500 per filter): paginate with
  `limit`/`until`; live subs use `since`.
- `created_at` must strictly exceed the previous event at the same address
  or the relay keeps the old one.
- strfry rejects events with `created_at` > 900 s in the future, older than
  3 years, or larger than 64 KB. Large records fail silently at the relay.
- No NIP-42 AUTH in the client. Any relay requiring AUTH drops everything.
- Browser storage: Gun's radisk has no browser adapter, so the nostr backend
  forces `localStorage` (~5 MB). IndexedDB via the new store lifts this.
- Hologram/federation copies must be edited through the owner holon
  (`sourceRef`); editing the copy forks a stray local record.
- Private lenses: wrong password fails the NIP-44 MAC; KDF params frozen.
- Federation must not create holograms by default; it is opt-in per feature.

---

## 6. First tasks

**Step 1 — Commons Hub site and storage**
1. Read `apps/kiosk/README.md`, then `packages/holosphere/NOSTR-BACKEND.md`,
   `STORE.md`, `SIGNING.md`, then `apps/kiosk/src/lib/holosphere.ts` and
   `config.ts`.
2. Run it: build core, `pnpm -F kiosk dev`, open `/commons`. Confirm in the
   console (`window.__kiosk`) that the backend is `nostr` and relays contain
   `wss://relay.holons.io`. Watch a write arrive:
   `nak req -k 30078 -t h=-5459621960 -t n=Holons --stream wss://relay.holons.io`.
3. Run the tests: `pnpm -r typecheck && pnpm test`, then read
   `packages/holosphere/test/nostr-backend.test.js` and the store tests to see
   the contracts.
4. Storage work on branch `remove-gun`: finish wiring `holosphere.js` /
   `content.js` / `signing.js` onto `store/`, keep the one LWW rule in
   `lww.js` the only place ordering is decided, make `subscribe` ride
   `store.watch`, keep every existing holosphere test green, then switch the
   kiosk cache to the IndexedDB adapter. Each change starts with a failing
   test.

**Step 2 — Nostr proper (later)**
- NIP-42 AUTH in `relay-transport.js` so community relays can restrict writes.
- A lens where the standard kind is authoritative (`primary: 'standard'`) and
  foreign records are imported.
- Honouring NIP-29 join requests (9021) from pubkeys not mapped to a member.
- Elinor occurrence publishing / reminders from the bot.
- The Pi relay (Appendix A).

---

## Appendix A — Raspberry Pi 4B community relay (later)

Goal: an **independent community relay** (own write policy) that the apps use
alone or beside `wss://relay.holons.io`.

**Hardware / OS.** Pi 4B, 4 GB+ (2 GB needs swap for the build). **64-bit OS
mandatory** (strfry mmaps LMDB at 10 TB of address space). Prefer USB-3 SSD
boot; SD cards wear under LMDB writes. 1 vCPU / 2 GB / 50 GB is plenty.

**Build (20–60 min on a Pi 4).**
```bash
sudo apt update && sudo apt install -y git g++ make libssl-dev zlib1g-dev \
  liblmdb-dev libflatbuffers-dev libsecp256k1-dev libzstd-dev
git clone https://github.com/hoytech/strfry && cd strfry
git submodule update --init && make setup-golpe && make -j2      # -j4 on 8 GB
sudo install -m 755 strfry /usr/local/bin/strfry
```
Docker alternative: `dockurr/strfry` (confirm arm64 with `docker manifest
inspect`); `packages/holosphere/spike/run-strfry.sh` shows the invocation.

**User, dirs, config.**
```bash
sudo useradd -r -s /usr/sbin/nologin strfry
sudo mkdir -p /var/lib/strfry && sudo chown strfry:strfry /var/lib/strfry
sudo cp strfry.conf /etc/strfry.conf     # start from the stock file (= packages/holosphere/spike/strfry.conf)
```
```
db = "/var/lib/strfry/"
relay {
    bind = "127.0.0.1"   port = 7777   nofiles = 0
    realIpHeader = "x-forwarded-for"
    auth { enabled = false }              # our client has no NIP-42
    info { name = "<community> relay"  description = "…"  pubkey = "<operator hex, not npub>"  contact = "<email>" }
    maxTagsPerFilter = 3                  # Holons sync uses #h #l #n — never lower
    maxFilterLimit = 500
    writePolicy { plugin = "/usr/local/bin/holons-write-policy.js"  timeoutSeconds = 10 }
    negentropy { enabled = true }
}
events { maxEventSize = 65536 }           # raise if large records are rejected
```

**Write policy** (line-JSON in → `{id, action: accept|reject|shadowReject, msg}` out;
input carries `sourceType` `IP4|IP6|Import|Stream|Sync|Stored`). A pubkey
allow-list does not fit Holons (member and browser keys are many and derived),
so gate on *what* is written:
```js
#!/usr/bin/env node
const rl = require('readline').createInterface({ input: process.stdin });
const NAMESPACES = new Set(['Holons']);
const KINDS = new Set([0, 5, 7, 8, 1059, 9000, 9001, 9021, 30003, 30009, 30078, 30402,
                       31922, 31923, 31925, 31926, 39000, 39001, 39002]);
rl.on('line', (line) => {
  const req = JSON.parse(line), ev = req.event;
  const res = { id: ev.id, action: 'accept', msg: '' };
  if (req.sourceType !== 'Import' && req.sourceType !== 'Sync') {
    if (!KINDS.has(ev.kind)) { res.action = 'reject'; res.msg = 'blocked: kind not served here'; }
    else if (ev.kind === 30078) {
      const n = (ev.tags.find((t) => t[0] === 'n') || [])[1];
      if (!NAMESPACES.has(n)) { res.action = 'reject'; res.msg = 'blocked: namespace not served here'; }
    }
  }
  process.stdout.write(JSON.stringify(res) + '\n');
});
```

**systemd.**
```ini
[Unit]
Description=strfry relay service
After=network-online.target
[Service]
User=strfry
ExecStart=/usr/local/bin/strfry relay
Restart=on-failure
RestartSec=5
ProtectHome=yes
NoNewPrivileges=yes
ProtectSystem=full
LimitNOFILE=65536
[Install]
WantedBy=multi-user.target
```

**TLS** (required: the apps are served over https, so the relay must be `wss://`).
Caddy: `relay.<community>.org { reverse_proxy 127.0.0.1:7777 }` — automatic
Let's Encrypt and WebSocket passthrough; needs public DNS and ports 80/443
(behind CGNAT use a Cloudflare Tunnel or Tailscale Funnel). Check:
`curl -H 'Accept: application/nostr+json' https://relay.<community>.org`.

**Backups and seeding.**
```bash
strfry export > /backup/events-$(date +%F).jsonl                 # nightly; restore with `strfry import`
strfry sync wss://relay.holons.io --filter '{"kinds":[30078],"#h":["-5459621960"]}'   # negentropy seed
```

**Point the apps at it:** comma-separated relay list in the root env file
(`wss://relay.<community>.org,wss://relay.holons.io` fans writes out to both
and merges reads). Variable names are in `.env.example`.

## Links
- NIP index: https://github.com/nostr-protocol/nips (start with 01, 09, 11, 44, 52, 99, 51, 29, 17)
- strfry: https://github.com/hoytech/strfry — `docs/DEPLOYMENT.md`, `docs/plugins.md`
- nostr-tools: https://github.com/nbd-wtf/nostr-tools · nak: https://github.com/fiatjaf/nak
- Elinor: https://elinor.commonshub.dev/docs
- Relay walkthroughs: https://usenostr.org/relay.html · https://www.relayrunner.org/relays/strfry/build/
