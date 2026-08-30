# Nostr backend — the relay is the wire

`backend: 'nostr'` runs the whole system on the Nostr relay. Gun stops being
the network: it stays on as the **local-first cache** (in-memory graph +
radisk, no peers), and **all networking happens over the Nostr relay(s)**:

- **write** — every non-private `put`/`delete` is published as a signed
  NIP-01 event (kind 30078, NIP-33 replaceable per location). This includes
  **holograms** and **globals**, which the plain signing layer skips.
- **read** — `get`/`getAll` first catch up the `(holon, lens)` from the relay
  (bounded by a sync timeout, so an unreachable relay degrades to a local
  read instead of blocking).
- **subscribe** — one live REQ per `(holon, lens)` stays open; remote events
  are signature-verified and fed into the local graph, which fires the
  existing subscription machinery unchanged.

Because every record on the wire is a signed, content-addressed event, the
durability/portability properties from [`SIGNING.md`](./SIGNING.md) hold for
the entire dataset: relay loss ≠ data loss (any client re-publishes),
switching relays is a verbatim copy, and no relay can forge anything.

## Quick start

```js
import HoloSphere from 'holosphere';
import { generateSecretKey } from 'holosphere/nostr-events.js';

const sphere = new HoloSphere({
  appName: 'Holons',
  privateKey: generateSecretKey(),      // device/actor key — signs every write
  backend: 'nostr',
  nostr: { relays: ['wss://relay.holons.io'] },
});
await sphere.ready();                    // transport is up

// The entire API is unchanged:
await sphere.put(holon, 'tasks', { id: 't1', title: 'Repair the well' });
const tasks = await sphere.getAll(holon, 'tasks');
sphere.subscribe(holon, 'tasks', (item, key) => { /* live, from the relay */ });
```

Guard rails:

- `backend: 'nostr'` **without** `nostr.relays` falls back to the gun backend
  with a console warning (several callers passed the flag aspirationally
  before the transport existed).
- No `privateKey` → an **ephemeral device key** is generated (writes still
  sign + sync, but identity doesn't survive a restart). Pass a persistent key
  for a stable identity.

## How it fits the existing layers

| Layer | gun backend | nostr backend |
|---|---|---|
| Gun graph | cache **and** wire (gun peers) | cache only (peerless) |
| Networking | Gun websocket mesh | `relay-transport.js` (SimplePool) |
| Signing layer | opt-in (`enableSigning`) | always on, **envelope-only** (`relays: []`) |
| Publisher | signer (when relays set) | transport (single publisher) |
| shadow / enforce | via `enableSigning` opts | via `config.signing.{shadow,enforce}` |

The signing layer is enabled automatically in envelope-only mode: local
`_events` attestation, shadow measurement, and enforce-mode authorized reads
all work exactly as documented in `SIGNING.md` — the transport just owns the
wire, publishing the very envelope events the signer issues (nothing is
signed or published twice). Ingested remote events are verified and mirrored
into the `_events` sidecar, so enforce mode authorizes remote data the same
way as local writes.

## Event scheme

```
kind 30078, content = JSON(item)
tags: [["h", holon|"_g"], ["l", lens], ["d", "holon/lens/id"], ["n", appname]]
```

- `h`/`l`/`d` — as in `SIGNING.md`; single-letter so relays index them.
- `n` — the **app namespace** (`appName`), so `Holons` and `HolonsDebug` can
  share one relay without bleeding into each other. Sync filters always
  include `#n`.
- Globals (`putGlobal`, holon-less records) travel with the sentinel
  `h = "_g"`.
- Deletes are signed `{ id, _deleted: true }` tombstones (same shape the
  signing layer uses); receivers store the tombstone, and normal reads
  filter it.

## Projections — standard kinds next to 30078

The 30078 record is opaque to every other Nostr client. With projection
hooks configured, each write on a listed lens is ALSO published as the
lens's standard kind, and each delete as a NIP-09 retraction. Projected kinds
never enter the `_events` sidecar and the 30078 `ingest` path never touches
them — 30078 stays the source of truth. External edits of them come back
through the reverse sync below. Codecs live in `@holons/core/nostr`;
`projections.js` here only signs and publishes what a hook returns.

| lens | kind | notes |
|---|---|---|
| `quests`, `events` | 31923 / 31922 (NIP-52) + 31925 RSVP per participant | undated quests skipped; `type:'need'` → 30402 |
| `offers` (+ need/offer/request quests) | 30402 (NIP-99) | `status active|sold`, `g` from `geohash` or the H3 `hex` |
| `users` | 0 (profile) | signed by the USER's key only (`signerFor`), never the holon's |
| `checklists`, `shopping`, `library` | 30003 (NIP-51 set) | entries as `['item', …]` tags |
| `quests`/`events` `appreciation[]` | 7 (NIP-25 reaction) per appreciator | signed by the APPRECIATOR's key on the record's address; `+` gives, `-` withdraws (Holons' reading of NIP-25) |
| `roles` | 30009 badge definition + kind 8 award (NIP-58) | holon-signed; award lists current holders with a key, re-issued only when holders change; no 30008 (user-owned) |
| `settings` (the holon doc) | 39000 group metadata + 39001 admins (NIP-29) | holon-signed; 39000 edits by a trusted key fold back into name/purpose/picture |
| `users` (membership) | 9000 put-user (holon) + 9021 join request (member) on join, 9001 remove-user on leave (NIP-29) | plus 39002 members published by the host from `buildGroupState` |

Every projected event carries `['n', appname]`, `['h', holon]`,
`['t', 'group-<holon>']` (same grammar as Elinor), `['holons', lens, holon, id]`
(origin pointer) and, for addressable kinds, `d = holons:<lens>:<holon>:<id>` —
holon-scoped so H3/federation copies never collide. Hologram/federation
copies and globals are not projected. `created_at` is kept strictly
monotone per `(kind, d)` so rapid re-puts are not rejected as "older".

Configure: `nostr: { relays, projections, signerFor }` (nostr backend) or
`enableSigning({ relays, projections, signerFor })` (gun + relay backup).
Build hooks with `buildProjections(parseProjectionList(env), ctx)` from
`@holons/core/nostr`; the monorepo apps read `HOLOSPHERE_PROJECTIONS` /
`VITE_HOLOSPHERE_PROJECTIONS` (`off` default | `all` | comma list).

### Mutual update — folding external edits back (`reverse-sync.js`)

When another Nostr client republishes one of those events — a calendar app
moving a 31923, Elinor-style RSVPs (31925), a market client closing a 30402,
a member editing their kind 0 — the edit is folded back into the record:

1. Per holon, two live REQs: `{kinds, '#t': ['group-<holon>']}` (clients that
   keep our tags) and `{kinds, authors: trusted}` (clients that rebuild tags;
   kind 0 only arrives here). Opened lazily by the first read/subscribe of a
   holon, `since = now − lookback` (7 days default).
2. **Trust**: `event.pubkey ∈ trustedAuthors(holon)` — host-supplied (the
   monorepo bot: holon key ∪ members' derived keys ∪
   `settings.nostrTrustedPubkeys`); default own key ∪ read-list. Anything
   else is dropped. An RSVP toggles the SIGNER's participation (the codec
   resolves the member via `ctx.userIdFor(pubkey)`); kind 0 only patches the
   signer's own `users` record.
3. **Merge**: the lens codec's `parse` maps the event to a claim and `merge`
   folds it into the current record — only fields the event carries, so a
   client that drops `location` does not blank it. Then a normal
   `put(..., { _skipProjections: true })`: signed and published as OUR 30078
   (gun subscribers, other Holons instances and enforce reads see it as an
   ordinary write) but not re-projected, so the ingested event is never
   echoed. `projector.noteExternal` keeps our next projection of that
   address strictly newer than the edit (no ratchet, no stale overwrite).
4. Guards: our own projections (`projector.wasEmitted`) are never folded
   back; a claim older than the last accepted one per `(kind, address)` is
   dropped; a claim for a record that does not exist locally is dropped —
   foreign records are never imported.

Lossiness (one-directional, by design): calendar kinds carry no
status/category/participants (RSVPs and reactions do); badge awards are
holon-authored and never folded back; NIP-99 `sold` closes an open
listing (`fulfilled`), `active` never reopens one; NIP-51 sets rebuild
`items[]` from `item` tags (library: only `borrowed`); kind 0 patches
`first_name/username/picture/about`.

Options: `nostr: { reverseSync, trustedAuthors, reverseLookbackSec }` /
`enableSigning({ … same … })`; `reverseSync` defaults to on whenever
`projections` are set. Apps: `HOLOSPHERE_PROJECTIONS_SYNC=on|off`,
`HOLOSPHERE_PROJECTIONS_LOOKBACK=7d` (and `VITE_…` for the web, which trusts
only its own key and read-list — the bot is the authority for member RSVPs).

Still not built: a lens making the standard kind *authoritative*
(`primary: 'standard'`, `x-holons` extras) and importing foreign records.

## NIP-29 groups — holon-authored

A holon is a NIP-29 group whose id is the holon id (the `h` tag). The relay
(strfry) does not implement NIP-29, so the **holon key** publishes what a
NIP-29 relay would sign: 39000 metadata (from `settings`: name, purpose →
`about`, picture, `public`, `closed`), 39001 admins (holon key +
`settings.admin` when their derived key resolves) and 39002 members (every
`users` record whose key resolves, via `buildGroupState` in
`@holons/core/nostr`, republished by the host only when the state hash
changes). Joining emits 9000 put-user (holon) and 9021 join-request
(member); leaving emits 9001. Consumers trust these from the holon pubkey —
the same root the reverse sync uses — and a real NIP-29 relay can take over
unchanged. Not built: honouring 9021 from pubkeys Holons cannot attribute
to a member (there is no Telegram id to create a `users` record for).

## NIP-17 private messages

`nostr-dm.js` sends/receives NIP-17 DMs (NIP-59 gift wrap, NIP-44) on the
active relay set: `sendDirectMessage(holo, { privateKey, recipientPubkey,
content, subject })`, `subscribeDirectMessages(holo, privateKey, onMessage)`.
The relay sees a kind-1059 by a throwaway key addressed to the recipient;
the sender is authenticated by the seal, never by the payload. The
federation handshake (`handshake-shim.js`) now rides on it whenever the
caller passes its key and relays exist, while still writing/reading the
legacy plaintext Gun `_dm/<pubkey>` channel for peers that have not
upgraded (messages carry an `id`, so a copy on both paths is handled once).
Generic host API: `holosphere.publishNostrEvents(events)`,
`holosphere.subscribeNostr(filter, onevent)`, `holosphere.nostrRelays()`.

## Semantics & limits

- **Conflicts** are last-writer-wins by event `created_at` (second
  granularity; equal timestamps apply in arrival order). Per-actor lenses
  (participation, votes …) should use the signing layer's per-author
  aggregate as before — each actor's record is their own event.
- **Private (password) lenses never touch the relay.** They are
  SEA-encrypted, access-controlled by the password, and publishing them
  would leak ciphertext + metadata; they remain local to the device in this
  backend.
- **Read-key hydration at init is local-only** (the transport isn't up yet
  when `enableSigning` runs). If your federation read-list lives remotely,
  call `refreshReadKeys()` after the first sync.
- **Relay policy**: the spike relay config is open; production should
  restrict writes (NIP-42 auth / allow-list) — see `spike/README.md`.
- **Browser cache storage**: in a browser the backend forces
  `radisk: false, localStorage: true` for Gun (callers can override).
  Gun's radisk has no browser adapter unless `gun/lib/rindexed` is loaded,
  so the stock `radisk: true` / `localStorage: false` default stores
  nothing — survivable on the gun backend (the peer answers every read),
  fatal here, where the local cache is the only reader and every read would
  come back empty. localStorage's ~5 MB quota is the current ceiling for the
  browser cache; loading the IndexedDB adapter would lift it.

## Wiring in the monorepo

- **web** (`apps/web`): `VITE_HOLOSPHERE_BACKEND=nostr` +
  `VITE_HOLOSPHERE_RELAYS=wss://relay.holons.io`. Shadow/enforce flow through
  the same `VITE_HOLOSPHERE_SIGNING` variable as before.
- **telegram bot**: `HOLOSPHERE_RELAYS=wss://relay.holons.io` (the bot already
  passes `backend: 'nostr'`; relays activate it).
- **mcp-ui**: `HOLOSPHERE_BACKEND=nostr` + `HOLOSPHERE_RELAYS=…`
  (+ optional `HOLOSPHERE_PRIVATE_KEY`).

## Tests

`test/nostr-backend.test.js` runs two+ peerless instances against the
in-process relay (`spike/mini-relay.js`): cold reads, live subscriptions,
LWW updates, deletes, globals, cold-start recovery, forged-event rejection,
and namespace isolation.
