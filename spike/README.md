# Spike: Nostr signing + relay persistence

Proves the core of [`../NOSTR-SIGNING-PLAN.md`](../NOSTR-SIGNING-PLAN.md): HoloSphere
records can be signed NIP-01 events (via **nostr-tools**) and persisted by a Nostr
relay (**strfry**), so GunDB data loss is recoverable.

## Run

```bash
# unit tests for the signing primitives
node --experimental-vm-modules node_modules/jest/bin/jest.js test/nostr-events.test.js

# against a REAL strfry relay (Docker) — start, round-trip, restart, verify survival
bash spike/run-strfry.sh

# or against the tiny embedded relay (no Docker needed)
node spike/roundtrip.mjs
```

## What it demonstrates

`roundtrip-strfry.mjs` (and the Docker-free `roundtrip.mjs`):
1. Signs a HoloSphere item `(holon, lens, item)` as a NIP-01 event (`../nostr-events.js`).
2. Publishes it to **both** a Nostr relay and a GunDB node (dual-transport).
3. Reads it back from Gun (live path).
4. **Wipes Gun's radisk dir** and opens a fresh, peerless node → data is gone locally.
5. **Rehydrates from the relay** with a tag query `{kinds:[30078], "#h":[holon], "#l":[lens]}`,
   re-verifies each signature, and restores it.
6. Confirms tampering (mutated content / bad sig / forged pubkey) fails verification.

`relay-fetch.mjs` runs **after `docker restart strfry-spike`** and proves the event
survived the relay process dying — the durability guarantee radisk does not give.

## Result (last run)

- `test/nostr-events.test.js` — **8/8 pass** (incl. a deterministic NIP-01 id vector).
- `roundtrip-strfry.mjs` — **✅ PASSED** against strfry 1.1.0.
- `relay-fetch.mjs` after restart — **✅ DURABILITY PASSED**.

## Files

- `../nostr-events.js` — `buildEvent` / `signEvent` / `verifyEvent` / `getEventHash`
  backed by **nostr-tools**. **Candidate for promotion to the library.**
- `roundtrip-strfry.mjs` — round-trip against real strfry (nostr-tools `SimplePool`).
- `relay-fetch.mjs` — restart-durability check.
- `run-strfry.sh` — one-shot: start strfry → round-trip → restart → verify survival.
- `strfry.conf` — strfry config with the `writePolicy` plugin disabled (open relay
  **for the spike only**; production restricts writes via NIP-42 auth / allow-list).
- `mini-relay.js`, `roundtrip.mjs` — Docker-free embedded relay + round-trip.
- `../test/nostr-events.test.js` — unit tests incl. forgery/tamper cases.

## strfry notes

- Image: `dockurr/strfry`. Default ships a pubkey-**whitelist** write policy
  (`/app/write-policy.py`); `strfry.conf` here sets `writePolicy.plugin = ""` to make
  it open for the spike. Data persists to the `strfry-spike-db` Docker volume (LMDB).
- The `h`/`l`/`d` tags are single-letter on purpose: strfry only indexes single-letter
  tags, so `{"#h":[...]}` / `{"#l":[...]}` filters work.

## Not in scope (see the plan)

Authorization/read-collapse (§5–6), encryption (§9), production relay deployment &
write-policy (§14). This spike only de-risks **signing** and **relay round-trip +
durability**.
