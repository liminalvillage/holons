# Holons handoff — the Commons Hub site first, Nostr second

Written 2026-09-03. The whole briefing for joining Holons work.

**The plan, in order**

1. **Now — the Commons Hub site.** The Commons Hub instance of the Holons
   web app (the kiosk at `commons.hubs.network`): its back end and its data
   storage, which run on Nostr. Use the production relays
   (`wss://relay.holons.io`, `wss://relay.commonshub.dev`); change only the
   website and the storage code.
2. **Later — Nostr itself.** Relay work, including a community relay on a
   Raspberry Pi 4B (Appendix A).

Read sections 1–3 once, top to bottom; sections 4–6 are the working reference.

---

## 1. Nostr in one page (the primer)

Nostr = "Notes and Other Stuff Transmitted by Relays". Not a blockchain, not a
P2P mesh. Three things:

1. **Keys.** Every actor is a secp256k1 keypair. The public key (32 bytes,
   64 hex chars) is the identity; the private key signs. Bech32 forms
   `npub1…` / `nsec1…` (NIP-19) are display encodings of the same hex. Code
   and relays work in hex; Holons env files hold secrets as `nsec1…`.
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
| 19 | bech32 `npub`/`nsec`/`naddr` | env keys, login UI (nsec import) |
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
- **App namespace** — `Holons` (production) and `HolonsDebug` (development)
  share the relays without mixing; carried in the `n` tag. The kiosk reads
  `Holons` by default.

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

**The relays are the wire.** A HoloSphere instance has no other network:
writes publish to the relay set, reads catch a `(holon, lens)` up from the
relays and answer from the local store, and one live REQ per `(holon, lens)`
keeps the store current. Every ingested event is signature-verified. Relay
loss ≠ data loss: any client can republish its own events; moving relays is a
verbatim copy. Without `relays` an instance is local-only (tests, offline
tooling). Every write is signed; there is no signing mode to choose.

Production relays (the default when an app configures none):
`wss://relay.holons.io` (strfry) and `wss://relay.commonshub.dev` (Elinor /
Commons Hub). `DEFAULT_RELAYS` and `resolveRelays(env)` in
`@holons/core/holosphere` are the one place that list lives.

### 2.3 The local store — a mirror of the relays
`packages/holosphere/store/` keeps every record the instance has seen in an
event-sourced store. The relays are the durable copy; the store is what makes
reads instant, subscriptions fire, and the app work offline
(`packages/holosphere/STORE.md`).

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
| `events` | event id | the signed envelope; only each author's latest claim per address (NIP-33). What signing/enforce reads | yes |
| `private` | `scope\|lens\|key` | NIP-44 ciphertext of password lenses | yes |
| `cursors` | `holon\|lens` | `{ since, syncedAt }` — how far the lens is synced | yes |
| `backlinks` | source soul | set of hologram-pointer souls | derived, rebuilt on open |

- **One ordering rule** (`store/lww.js`): `store.apply(event)` is the only
  place "which write is current" is decided. Newer `created_at` wins; on a tie
  the larger event id; unsigned local writes (`putRaw`) lose ties to signed
  events. Re-applying a known event id is a no-op, so relay echoes need no
  dedup set. Local writes always become current because `nextCreatedAt` bumps
  one second past whatever is current when the clock has not moved.
- **Versions are linear per author and address**: each author's newest claim
  per `(kind, pubkey, d)` is kept in `events`; `records` holds the winner
  across authors. `apply` reports why an event was not applied:
  `seen | kind | foreign | malformed | invalid | stale`.
- **Change feed**: `store.watch(holon, lens, cb)` replays the current
  non-tombstone records on a microtask, then one call per accepted change,
  tombstones included with `meta.tombstone`. Every subscriber gets its own
  full replay; there is no "first listener only" behaviour and no echo storms.
- **Private lenses**: key = `scrypt(password, "<app>:<holon|lens>", N=2^15, r=8,
  p=1, 32 bytes)`, payload `nip44.v2.encrypt(JSON(item), key)`. Never signed,
  published, propagated, indexed or exported. A wrong password fails the
  NIP-44 MAC. **KDF parameters are frozen**; changing them orphans every
  existing private record.
- **Adapters**: `memory` (tests, serverless functions, scripts), `indexeddb`
  (browsers: DB `holosphere:<app>`, one read-write transaction per batch,
  quota errors degrade to memory-only with a warning), `file` (Node:
  `<dir>/<app>.snapshot.json` + `<dir>/<app>.log.jsonl`, log replayed and
  compacted on open and after 50 000 ops, one process per directory; loaded
  lazily so browser bundles never pull in `node:fs`). `adapter: 'auto'` picks
  IndexedDB when present, memory otherwise. Long-lived Node hosts (the bot)
  pass `store: { adapter: 'file', dir }`; `HOLOSPHERE_STORE_DIR` sets the
  directory (default `./holosphere-store`).
- **Sync cursors and backfill** (`relay-transport.js`): a cold store backfills
  a lens with paginated `limit`/`until` queries (page size 500, strfry's cap;
  at most 2000 pages); a warm store asks for `since: cursor − 900 s` (overlap
  against writer clock skew; re-applying is a no-op) and then keeps a live
  subscription open. Cursors are set by the transport only after a complete
  backfill, so a crash mid-backfill cannot skip history. A cold read waits at
  most `nostr.syncTimeoutMs` (5 s) for the catch-up, then answers from the
  store while the catch-up continues. Hard-closed subscriptions reopen with
  3 s → 10 s → 30 s → 60 s backoff; `hs.resyncSubscriptions()` re-syncs
  everything (the browser apps call it on `online` / `visibilitychange`).

```ts
interface StoreAdapter {
  open(): Promise<StoreSnapshot | null>;   // { records[], events[], private[], cursors[] }
  append(ops: StoreOp[]): Promise<void>;   // rec | evt | evt-del | priv | priv-del | cur
  snapshot(full: StoreSnapshot): Promise<void>;
  clear(): Promise<void>;
  close(): Promise<void>;
}
// Store: open/flush/compact/clear/close/snapshot/stats · apply · putRaw · nextCreatedAt ·
//        get/list/listKeys/listLenses/listHolons · getEvents/listEventIds · getBacklinks ·
//        watch · getCursor/setCursor · privatePut/privateGet/privateList   (store/store.d.ts)
```

Holosphere-level helpers over the store: `listHolons()` (store ∪ the
`holons_registry` global — a cold client only knows the registry),
`exportEvents(filter)` / `importEvents(events, { publish })` to move a store,
`listLenses`, `listKeys`, `getBacklinks`.

### 2.4 Projections: standard kinds next to 30078
30078 is opaque to other Nostr apps, so per lens each write is *also*
published as the standard kind and each delete as a kind-5 retraction. This is
**on for every lens by default on every surface**; `HOLOSPHERE_PROJECTIONS` /
`VITE_HOLOSPHERE_PROJECTIONS` (`off` | comma list of lenses) narrow or disable
it. Each surface builds the option block with
`projectionOptionsFor({ appName, privateKey, lenses, cellToLatLng })` from
`@holons/core/nostr`.

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
`d = holons:<lens>:<holon>:<id>`. Hologram/federation copies and globals are
not projected.

**Reverse sync** (`reverse-sync.js`, on whenever projections are) folds
external edits of those kinds back: a calendar app moving a 31923, an Elinor
RSVP, a market client closing a 30402, a member editing kind 0. Per holon two
live REQs (`#t = group-<holon>`, and `authors = trusted`), opened by the first
read of the holon with a 7-day lookback. Only *trusted* pubkeys (holon key,
members' derived keys, extras from settings; default own key ∪ read-list) may
claim anything; the claim is merged by the lens codec and re-written as our
own 30078 without re-projecting it. Foreign records are never imported; 30078
stays canonical.

### 2.5 Keys and signing — who signs what
| identity | held where | signs |
|---|---|---|
| service key (`HOLOSPHERE_NSEC`) | bot, discord, mcp, scripts | 30078 records, holon-level projections; its public half is `VITE_HOLOSPHERE_NPUB` (the web HNS registry id) |
| member key | derived server-side from the Telegram identity + `NOSTR_DERIVATION_SECRET` (load-bearing: changing it changes every member's pubkey) | kind 0, RSVPs, reactions, join requests, Elinor signups |
| identity-provider key | derived, service-level | kind-31926 attestations linking one person's several keys |
| kiosk device key | the browser's localStorage, generated once | the kiosk's own writes; the logged-in user is recorded as `actingAs` |
| browser own key | user's device (nsec import, passkey, Ethereum wallet → all end in a Nostr keypair) | the user's writes from web/kiosk when they log in with a key |

Rules: secrets are `*_NSEC` env vars holding `nsec1…` (hex accepted); no
secret ever carries a `VITE_` prefix; Ethereum keys are `ETH_*` and never a
Nostr key. **UIs never hold raw keys** in code paths: they receive a
`NostrSigner` (`pubkey` + `sign(template)`) from `@holons/core/holosphere`.

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
vertical screen with an editable tab strip (Tasks, Calendar, Shifts, Library,
Lists, Roles, Status, Flows; drag to reorder, hold to hide/add, per device),
auto-rotating unless someone is interacting; a **dock** shrinks the board to
one circle per holon the device has opened; a home page when no holon
resolves. Read-only for visitors; editing after login (Telegram, passkey, own
Nostr key or Ethereum wallet). It reuses the shared Holosphere factory and the
core domain helpers and re-implements **no domain rules** — core owns meaning.

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
Settings/localStorage → `VITE_KIOSK_HOLON`. The app namespace resolves
`?app=` → Settings → `VITE_KIOSK_APP` → `Holons`.

### 3.2 How the site talks to Nostr (the "back end")
There is no application server holding data. The browser *is* the client:

```
browser (kiosk)                                              relays
 ├─ holosphere.ts  getHolosphere()
 │     createHoloSphere({ appName, privateKey: deviceKey, relays: resolveRelays(),
 │                        store: { adapter: "indexeddb" },
 │                        nostr: projectionOptionsFor({ appName, privateKey, lenses, cellToLatLng }),
 │                        awaitReady: true })                   ──►  REQ / EVENT (30078 + standard kinds)
 ├─ +layout.svelte  hs.subscribeFederated(holon, lens, …)      ◄──  quests, library, roles, checklists (+ partners' items, stamped _federation)
 │                  subscribeLens(hs, holon, "hidden", …)      ◄──  per-device hidden records
 ├─ getWriter(holon).put(lens, item)  (actingAs = logged-in user) ──►  signed 30078 + projections
 ├─ shifts.ts  subscribeSchedule()                             ◄──  31923 / 31925 / 31926 from relay.commonshub.dev
 └─ /api/* (Netlify functions, apps/kiosk/src/routes/api)
        auth/telegram/*, auth/key (NIP-98), auth/session → JWT session cookie scoped to .hubs.network
        shifts/rsvp                                     → signs an Elinor RSVP server-side as the member
        quest/refresh, image, avatar, opencollective, ai/* → thin proxies (bot API, Telegram files, OpenAI)
```

Key files (under `apps/kiosk/src/lib/`):
- `holosphere.ts` — builds the one instance through the core factory; device
  key; `subscribeLens` (accumulates a lens into a Map keyed by id,
  `null`/`_deleted` = removal); `subscribeLensPresence` (the dock map's
  per-cell presence); `getWriter` (identity-aware writes with `actingAs`,
  resolves `false` on denial); `getLibraryDb`, `getChecklistStore`,
  `getReaStore` adapters so core's borrow/return, checklist CRUD and REA
  completion own their meaning; `announceWrite` feeds the write-echo watchdog.
- `config.ts` — the resolution order above; `resolveRelays()`
  (`VITE_KIOSK_RELAYS` → `VITE_HOLOSPHERE_RELAYS` → production set, via core's
  `resolveRelays`); tab, view and theme preferences; shift relays and
  coordinator.
- `stores.ts` — the `TABS` registry, tab order and visibility, raw lens
  stores. `data.ts` — view-model shaping only; every rule it calls comes from
  `@holons/core/tasks|library|checklists|datetime`.
- `scope.ts`, `personal.ts`, `membership.ts` — the Show pill (Personal /
  Local / Global).
- `shifts.ts` — the Elinor feed (2.6). `sessionKey.ts`, `login/`, `auth.ts` —
  identity. `dock.ts`, `taborder.ts`, `tabroute.ts` — dock and tab state.
- `holons.ts` — tenant registry + `parseHolonRef` (spec'd in `holons.test.ts`).
- `routes/[[holon]]/[[tab]]/+page.svelte` + `+layout.svelte` — the board,
  its subscriptions and the window ⇄ dock morph.

Configuration is the monorepo-root `.env` (contract in `.env.example`); the
kiosk reads `VITE_KIOSK_HOLON`, `VITE_KIOSK_APP`, `VITE_KIOSK_RELAYS`,
`VITE_KIOSK_PROJECTIONS` (else the shared `VITE_HOLOSPHERE_*`),
`VITE_TELEGRAM_BOT_USERNAME`, the shift relay/coordinator variables and the
voice variables; server functions read `TELEGRAM_OIDC_*`, `AUTH_JWT_SECRET`,
`BOT_TOKEN`, `NOSTR_DERIVATION_SECRET`. The kiosk reads **production**
(`Holons`) by default.

### 3.3 Develop and deploy
```bash
pnpm install
pnpm -F @holons/core build        # apps consume core's compiled dist — rebuild after any core change
pnpm -F kiosk dev                 # http://localhost:5273 → open /commons or /-5459621960
pnpm -F kiosk test                # vitest (holons, taborder, shifts, scope, data …)
pnpm -F kiosk typecheck && pnpm -F kiosk lint
pnpm -r typecheck && pnpm test && pnpm lint     # the gate before "done"
```
In dev the instance is exposed as `window.__kiosk` for poking from the console
(`await __kiosk.listHolons()`, `__kiosk.nostrRelays()`, `__kiosk.exportEvents()`).

Deploy: Netlify, base directory `apps/kiosk`, build runs from the monorepo
root and builds core first (`netlify.toml`; Node 24 so the functions have a
global `WebSocket` for nostr-tools; explicit `[functions] directory` so the
SSR functions deploy; the build also triggers on changes under
`packages/core`, `packages/holosphere`, `packages/ai-ui`). Some hub sites
build from the fork `Valley-of-the-Commons/holons` — push the branch there
too or the screens never update. Telegram login domain is `hubs.network`
(one BotFather `/setdomain` covers every subdomain); each tenant's callback
URL is registered in BotFather Web Login.

---

## 4. Repo map and interfaces for the Nostr code

Monorepo (pnpm). One rule above all: **core owns meaning, UIs only render.**

```
apps/kiosk/                     the hub site (3.)
apps/web/                       full dashboard (SvelteKit)      apps/wequest/  quest-sharing site
packages/core/src/nostr/        codecs lens ⇄ standard kind, tags, registry, projectionOptionsFor, NIP-29 groups, NIP-17 DM helpers, nsec/npub helpers
packages/core/src/shifts/       Elinor NIP-52 rules + relay client + 31926 attestations
packages/core/src/auth/         key derivation, NIP-98, provider-agnostic identity
packages/core/src/holosphere/   the ONE factory (createHoloSphere), relays.ts (DEFAULT_RELAYS, resolveRelays), HolonWriter, NostrSigner / identity context, provenance (sourceRef)
packages/holosphere/            the data library (plain JS):
   holosphere.js                the class: put/get/getAll/delete/subscribe, globals, holograms, federation, listHolons, export/importEvents
   nostr-events.js              build / sign / verify 30078, normalizeSecretKey (nostr-tools)
   relay-transport.js           the wire: publish, paginated backfill, cursor catch-up, live REQs, reopen backoff
   store/                       the local store (2.3): index.js, store.js, lww.js, private.js, address.js, adapters/{memory,indexeddb,file}.js
   projections.js, reverse-sync.js, nostr-dm.js (NIP-17), signing.js
   spike/                       mini-relay.js (in-process NIP-01 relay for tests), strfry.conf, run-strfry.sh
   NOSTR-BACKEND.md  STORE.md  SIGNING.md   ← the authoritative docs; read all three
docs/shifts-elinor.md  docs/architecture.md  docs/realtime-sync.md
packages/telegram-ui/           the bot (service key lives here; authority for member RSVPs; file store)
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

### 4.2 Factory, signing and writing helpers (`packages/core/src/holosphere/`)
```ts
createHoloSphere({ appName, privateKey?, relays?, store?: { adapter, dir, compactAfter },
                   nostr?: { syncTimeoutMs, pageSize, projections, signerFor, providerKey,
                             reverseSync, trustedAuthors, reverseLookbackSec }, awaitReady? })
resolveRelays(env: string | string[] | undefined): string[]   // configured list or DEFAULT_RELAYS
createHolonWriter(hs, holonId, { actingAs, onDenied }): HolonWriter
export interface NostrSigner { readonly pubkey: string; sign(template: SignableTemplate): Event }
signerFromSecretKey(hex: string): NostrSigner
createIdentityContext({ derivationSecret }): { memberSigner, memberPubkey, providerSigner, providerPubkey }  // all null without the secret
```

### 4.3 Working rules (from CLAUDE.md, non-negotiable)
1. Behaviour changes go in `@holons/core/<domain>`; never re-implement rules in a UI.
2. No UI imports in core (type-only imports are fine).
3. Subpath imports only: `import { x } from '@holons/core/nostr'`.
4. All identity-aware I/O goes through the one Holosphere factory in
   `@holons/core/holosphere`; never `new HoloSphere()` in a UI.
5. Test-first: every core change ships a vitest spec next to it
   (`nostr.test.ts`, `reverse.test.ts`, `shifts.test.ts` are the models).
   Holosphere uses jest: every suite builds instances through
   `test/helpers/testenv.js` (fresh in-memory store, no relays;
   `startLocalRelay()` boots the in-process relay for wire tests;
   `HOLO_TEST_SIGNING=shadow|enforce` runs the suite in the read-gating
   modes); store tests live in `test/store/` and use `fake-indexeddb`.
6. Never commit secrets; if one leaks, rotate it.
7. Before "done": `pnpm -r typecheck && pnpm test && pnpm lint` from a clean
   tree. Sign off commits (`git commit -s`). Conventional Commits with scope
   (`kiosk: …`, `holosphere/store: …`, `core/nostr: …`). New files get the
   SPDX header `AGPL-3.0-or-later`.

---

## 5. Gotchas
- `@holons/core` subpath imports resolve to `dist/`; rebuild core after
  changes or the running app keeps stale code while tests stay green.
- nostr-tools needs a global `WebSocket`: Node ≥ 22 (the bot host, lambdas),
  or the optional `ws` package on older Node.
- Cold reads race the relay; never force synchronous reads. Everything is
  eventually consistent. Clean up every subscription and timer.
- Relays cap one response (strfry: 500 per filter): paginate with
  `limit`/`until`; live subs use `since`.
- `created_at` must strictly exceed the previous event at the same address
  or the relay keeps the old one.
- strfry rejects events with `created_at` > 900 s in the future, older than
  3 years, or larger than 64 KB. Large records fail silently at the relay.
- No NIP-42 AUTH in the client. Any relay requiring AUTH drops everything.
- The file store allows one process per directory; two bots on one
  `HOLOSPHERE_STORE_DIR` corrupt each other.
- A cold client only knows the holons in the `holons_registry` global;
  `scripts/backfill-holons-registry.mjs` fills it from a warm bot store.
- Hologram/federation copies must be edited through the owner holon
  (`sourceRef`); editing the copy forks a stray local record.
- Private lenses: wrong password fails the NIP-44 MAC; KDF params frozen.
- Federation does not create holograms by default; it is opt-in per feature.
- `.claude/worktrees/*` are stale worktrees — exclude them from repo-wide greps.

---

## 6. First tasks

**Step 1 — Commons Hub site and storage**
1. Read `apps/kiosk/README.md`, then `packages/holosphere/NOSTR-BACKEND.md`,
   `STORE.md`, `SIGNING.md`, then `apps/kiosk/src/lib/holosphere.ts` and
   `config.ts`.
2. Run it: build core, `pnpm -F kiosk dev`, open `/commons`. In the console
   check `__kiosk.nostrRelays()` and `await __kiosk.listHolons()`. Watch a
   write arrive:
   `nak req -k 30078 -t h=-5459621960 -t n=Holons --stream wss://relay.holons.io`.
3. Run the tests: `pnpm -r typecheck && pnpm test`, then read
   `packages/holosphere/test/nostr-backend.test.js`, `relay-sync.test.js` and
   `test/store/*.test.js` to see the contracts.
4. Storage work lives in `packages/holosphere/store/` and
   `relay-transport.js`. Keep `lww.js` the only place ordering is decided,
   keep every holosphere test green, and start each change with a failing
   test (jest for holosphere, vitest for core and the kiosk).

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
alone or beside the production relays.

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

**Point the apps at it:** comma-separated relay list — `VITE_KIOSK_RELAYS`
(kiosk), `VITE_HOLOSPHERE_RELAYS` (web), `HOLOSPHERE_RELAYS` (bot, mcp);
`wss://relay.<community>.org,wss://relay.holons.io` fans writes out to both
and merges reads.

## Links
- NIP index: https://github.com/nostr-protocol/nips (start with 01, 09, 11, 44, 52, 99, 51, 29, 17)
- strfry: https://github.com/hoytech/strfry — `docs/DEPLOYMENT.md`, `docs/plugins.md`
- nostr-tools: https://github.com/nbd-wtf/nostr-tools · nak: https://github.com/fiatjaf/nak
- Elinor: https://elinor.commonshub.dev/docs
- Relay walkthroughs: https://usenostr.org/relay.html · https://www.relayrunner.org/relays/strfry/build/
