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
