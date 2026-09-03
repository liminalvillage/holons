# Spike: Nostr signing + relay persistence

Proves the core of the signing layer (see [`../SIGNING.md`](../SIGNING.md)): HoloSphere
records are signed NIP-01 events (via **nostr-tools**) and the relay is the durable copy —
the local store (see [`../STORE.md`](../STORE.md)) is only a cache, so losing it costs nothing.

## Run

```bash
# unit tests for the signing primitives
node --experimental-vm-modules node_modules/jest/bin/jest.js test/nostr-events.test.js

# against a REAL strfry relay (Docker) — start, round-trip, restart, verify survival
bash spike/run-strfry.sh

# or against the tiny embedded relay (no Docker needed)
node spike/roundtrip.mjs

# read-list (enforce mode) and per-author aggregate demos, over the embedded relay
node spike/dashboard-demo.mjs
node spike/participate-demo.mjs
```

## What it demonstrates

`roundtrip-strfry.mjs` (and the Docker-free `roundtrip.mjs`):
1. A HoloSphere instance on an in-memory store writes an item `(holon, lens, item)`;
   the library signs it as a NIP-01 event (`../nostr-events.js`) and publishes it.
2. The instance is **closed** — its local cache is gone.
3. A **fresh** instance (empty store, same relay) reads the item back: rehydrated
   from the relay with a tag query `{kinds:[30078], "#h":[holon], "#l":[lens]}`,
   signature re-verified.
4. The raw event on the relay verifies; tampering (mutated content / bad sig) fails.

`relay-fetch.mjs` runs **after `docker restart strfry-spike`** and proves the event
survived the relay process dying — the relay's LMDB is the durable copy.

`dashboard-demo.mjs` — two instances share one relay; "me" runs in enforce mode
and only sees authors on its read-list (`addReadKey` / `removeReadKey` / `getPending`).

`participate-demo.mjs` — why "participate" must be a per-author record
(`sphere.aggregate`) rather than an array on the shared item (last write wins).

## Files

- `../nostr-events.js` — `buildEvent` / `signEvent` / `verifyEvent` / `getEventHash`
  backed by **nostr-tools** (promoted to the library).
- `roundtrip-strfry.mjs` — round-trip against real strfry (nostr-tools `SimplePool`).
- `relay-fetch.mjs` — restart-durability check.
- `run-strfry.sh` — one-shot: start strfry → round-trip → restart → verify survival.
- `strfry.conf` — strfry config with the `writePolicy` plugin disabled (open relay
  **for the spike only**; production restricts writes via NIP-42 auth / allow-list).
- `mini-relay.js` — Docker-free embedded relay (also used by the test suite's
  `startLocalRelay()`); `roundtrip.mjs` and the two demos run on it.
- `../test/nostr-events.test.js` — unit tests incl. forgery/tamper cases.

## strfry notes

- Image: `dockurr/strfry`. Default ships a pubkey-**whitelist** write policy
  (`/app/write-policy.py`); `strfry.conf` here sets `writePolicy.plugin = ""` to make
  it open for the spike. Data persists to the `strfry-spike-db` Docker volume (LMDB).
- The `h`/`l`/`d` tags are single-letter on purpose: strfry only indexes single-letter
  tags, so `{"#h":[...]}` / `{"#l":[...]}` filters work.
