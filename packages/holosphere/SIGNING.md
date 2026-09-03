# Signing (Phase 1) — sign-on-write + relay persistence

Opt-in NIP-01 signing for HoloSphere. When enabled, every `put` also publishes a
**signed Nostr event** to your relay(s), so your data is durable beyond one device
and portable across relays. Since 2.0 the constructor's `relays` do this for every
write; `enableSigning` remains for the read-side modes (shadow / enforce) and for
instances built without relays.

Requires the optional `nostr-tools` dependency (loaded lazily, only when enabled).

## Quick start

```js
import HoloSphere from 'holosphere';
import { generateSecretKey } from 'holosphere/nostr-events.js';

const sphere = new HoloSphere({
  appName: 'my-app',
  privateKey: generateSecretKey(),            // your actor key
  store: { adapter: 'memory' },
});

await sphere.enableSigning({
  relays: ['wss://relay.example.com'],         // one or more Nostr relays
});

// Writes as usual — now also signed + published to the relay(s):
await sphere.put('89283082803ffff', 'tasks', { id: 'task-1', title: 'Repair the well' });
```

Without `enableSigning()` nothing changes — signing is strictly opt-in.

**Transparent once enabled.** Domains keep calling `put` / `get` / `getAll` / `delete` /
`subscribe` exactly as before — holosphere does the rest:
- `put` is signed automatically; `delete` writes a signed tombstone (an unauthorized
  key can't drop your data, and a per-actor record can be retracted by its owner).
  Writes are **race-free**: the signed envelope is issued *before* the raw write, so a
  read (or subscriber) immediately after `await put` already resolves the new value.
- `get` / `getAll` / `subscribe` resolve through verify → read-list filter → collapse
  (singleton) or per-author aggregate. Resolution reads the **signed envelope store**,
  so scribbling or deleting a raw slot can't change what you see. `subscribe` also
  **notifies on deletes** — `callback(null, key)` when an item is removed.

The only things the app declares are *that* signing is on (`enableSigning`) and *which*
lenses are per-author (`perActorLenses`). Note: a per-author collection must be its own
lens of records (write `id` = subject) — an array embedded inside another item is still
one blob and can't be merged transparently.

**Globals are just holon-less get/put.** `getGlobal`/`putGlobal`/`getAllGlobal`/
`deleteGlobal` are thin aliases for `get`/`put`/`getAll`/`delete` with `holon = null`
(data at `appname/table/key`). Global tables hold infrastructure (e.g. the federation
config) and skip signing/resolution.

## Recover after data loss

If the local store is lost, every read of a lens rebuilds it from the relay
(signatures are re-verified; forgeries dropped); a store can also be moved with
`exportEvents()` / `importEvents()`:

```js
const events = await sphere.exportEvents({ holon: '89283082803ffff', lens: 'tasks' });
await other.importEvents(events);
```

## Switching relays — taking your data with you

**This is the answer to "how do I move all my data when I switch relays."** Because
every record is a *signed, content-addressed* event, moving relays is just **copy**:
read your events from the old relay and republish the **same** events to the new one.
Signatures stay valid (nothing is re-signed) and ids dedup, so it is idempotent and
trustless — the new relay can verify everything without trusting the old one.

```js
// Move EVERYTHING you've authored (across every holon & lens) to a new relay,
// then switch to it:
const { total, moved, switched } = await sphere.migrateRelays({
  to: ['wss://new-relay.example.com'],
  switch: true,                 // start using the new relay after the move
});

// Or mirror to several relays for redundancy instead of moving:
sphere.setSigningRelays([
  'wss://relay-a.example.com',
  'wss://relay-b.example.com',
]);
// subsequent writes fan out to all of them
```

How it works under the hood (`migrateRelays`):
1. `querySync(from, { authors: [you] })` — fetch **all** your signed events from the
   old relay(s) in one query (no per-holon bookkeeping needed; your pubkey is the
   index).
2. Re-`publish(to, event)` each event **verbatim** to the new relay(s).
3. Optionally `switch` your active relay set to the new ones.

Because the relay never holds your key, it can serve or withhold but never forge —
so your identity and history are yours, independent of any single relay. Running >1
relay (mirror) means no relay is a single point of failure; losing one costs nothing.

### Narrower moves

```js
// move just one holon/lens:
await sphere.migrateRelays({ to: ['wss://new'], filter: { '#h': ['<holon>'], '#l': ['tasks'] } });
```

## Shadow mode — measure the forgery surface before enforcing

Before Phase 2 turns on *authorized read* (where only signed, authorized data is
displayed), shadow mode lets you measure how much existing data would be affected —
**without changing anything that's returned**. With `shadow: true`, each `put` also
keeps its signed event in the store's events table (invisible to normal reads), and reads classify every item as **accounted** (backed by a valid signature)
or **would-drop** (unsigned / mismatched / invalid signature).

```js
await sphere.enableSigning({ relays: ['wss://relay'], shadow: true });

// ... app runs normally; getAll output is identical to before ...

// audit a lens on demand:
const r = await sphere.auditLens('89283082803ffff', 'tasks');
// { items: 1200, accounted: 1187, wouldDrop: 13, unsigned: 13, invalidSig: 0, mismatch: 0 }

// or read the cumulative report across all reads:
const report = sphere.getShadowReport();
// report.byPubkey shows which keys account for which volume of data
```

`wouldDrop` is exactly what Phase 2's authorized-read would hide. Watching it go to
~0 as clients adopt signing is the green light to flip enforcement on.

## Authorized read — your federation read-list (default)

With `enforce: true`, reads no longer return raw store items — they return the
**authorized view**: for each item, the latest claim from a key **you trust** wins;
everything else (unsigned, invalid, or from a key you don't read) drops to a
**pending** view. The raw store is untouched (open graph); enforcement happens
entirely at read time.

"Keys you trust" = **your saved federation list** — your own key (always) plus the
keys you've federated with. On `enableSigning` the read-set is **hydrated from your
saved federation** (under your read space — your own key by default), and
`addReadKey`/`removeReadKey` **write through** to that federation list. The allow-list
and the federation list are one and the same. Nostr follow model: truth is relative
to whose keys you read, **current-list** — removing a key hides its writes.

```js
await sphere.enableSigning({
  relays: ['wss://relay'],
  enforce: true,
  // readKeys: ['npub1…'],          // optional in-memory seed
  // federationSpace: myHomeHolon,  // whose saved federation = my read-list (default: my key)
});

await sphere.addReadKey('npub1…');    // trust a key (npub/hex) -> saved to federation
await sphere.removeReadKey('npub1…'); // stop reading it       -> removed from federation
await sphere.refreshReadKeys();       // reload from saved federation
sphere.getReadKeys();                 // [yourKey, ...savedFederation]

const tasks   = await sphere.getAll(holon, 'tasks');    // only keys you trust
const dropped = await sphere.getPending(holon, 'tasks');// unsigned / untrusted / invalid
```

No genesis, no admins, no per-holon setup — each reader curates their own trust.

### Optional: holon-owned authority (`enforce: 'membership'`)

When the *space* should define who may write (a shared treasury, a formal org) rather
than each reader choosing, use the signed `_members` log: a genesis key founds the
holon and admins add/remove members, folded **as-of-time** (a key's past writes stay
valid after it's removed).

```js
await sphere.enableSigning({ relays: ['wss://relay'], enforce: 'membership' });
await sphere.foundHolon(holon);                 // your key becomes genesis admin
await sphere.addMember(holon, theirPubkey);     // or role 'admin'
await sphere.removeMember(holon, theirPubkey);
await sphere.getMembers(holon);                 // Map(pubkey -> 'admin' | 'member')
// sphere.setGenesis(holon, pubkey) to pin a trust anchor you were given (else TOFU)
```

## Per-author aggregate — signed, filterable collaborative state

Collaborative state where many actors each assert their own status — **participation,
reactions, votes, RSVPs** — must NOT be a shared mutable array (one item everyone
overwrites): under signing, concurrent writes last-writer-win and clobber each other.

Instead, store **one signed record per actor**: write with `id` = the *subject* (e.g.
the quest id). Each actor's record lives under their own key (the signer IS the
owner), so:
- it **can't be forged** across keys (B's write lands in B's slot, not A's),
- it's **filtered** by your read-list,
- a **toggle** is just a newer record from that actor replacing only their own.

`aggregate()` returns each trusted actor's latest record (tagged `_owner`, `_subject`):

```js
await sphere.enableSigning({ enforce: true, perActorLenses: ['participation'] });

// each client signs its own record for quest 'q1' (concurrent-safe, no read-modify-write):
await sphere.put(holon, 'participation', { id: 'q1', user: 'alice', status: 'in' });
// … alice toggles off later — a newer record from her key:
await sphere.put(holon, 'participation', { id: 'q1', user: 'alice', status: 'out' });

const recs  = await sphere.aggregate(holon, 'participation', 'q1');  // [{...,_owner,_subject}]
const going = recs.filter((r) => r.status === 'in').map((r) => r._owner);
```

Registering a lens via `perActorLenses` (or `setPerActorLens`) makes enforce-mode
`getAll(holon, lens)` aggregate it automatically. Trust each record's `_owner` (the
signer), not its self-reported fields.

## API

| Method | Purpose |
|---|---|
| `await sphere.enableSigning({ privateKey?, relays?, readKeys?, shadow?, enforce?, storeEnvelope?, verbose? })` | Turn on signing; `shadow` = measure, `enforce: true` = federation read-list, `enforce: 'membership'` = holon authority |
| `sphere.addReadKey(npubOrHex)` / `removeReadKey(...)` / `getReadKeys()` | Manage your federation read-list (default `enforce`) |
| `await sphere.aggregate(holon, lens, subject?)` | Per-author records (latest per trusted actor; `_owner`/`_subject`) for signed collaborative state |
| `sphere.setPerActorLens(lens)` (or `enableSigning({ perActorLenses })`) | Mark a lens per-author → enforce `getAll` aggregates it |
| `await sphere.getPending(holon, lens)` | Items hidden by enforce-mode (unsigned/untrusted/invalid) |
| `await sphere.foundHolon(holon)` | *(membership mode)* Self-sign the genesis event (you become admin) |
| `await sphere.addMember(holon, pubkey, role?)` / `removeMember(...)` / `getMembers(holon)` / `setGenesis(holon, pubkey)` | *(membership mode)* Manage the signed `_members` log |
| `sphere.disableSigning()` | Stop signing, close relay connections |
| `sphere.signingEnabled` | Boolean |
| `sphere.getSigningRelays()` / `sphere.setSigningRelays(list)` | Read / replace relay set |
| `await sphere.exportEvents(filter?)` / `importEvents(events, { publish? })` | Move/mirror signed data across stores and relays |
| `await sphere.auditLens(holon, lens)` | Shadow-audit a lens (accounted vs would-drop); output unchanged |
| `sphere.getShadowReport()` / `sphere.resetShadowReport()` | Cumulative shadow stats |

## Using it in the holons dashboard

The web dashboard (`apps/web`) wires signing onto the instance it builds, controlled
by env (default **off** — no behavior change):

```bash
# apps/web/.env
VITE_HOLOSPHERE_SIGNING=shadow            # off (default) | shadow | enforce
VITE_HOLOSPHERE_RELAYS=wss://relay.example.com,wss://relay2.example.com   # optional
VITE_HOLOSPHERE_READ_KEYS=npub1abc…,npub1def…   # enforce: keys you trust to read (your own is implicit)
```

- `shadow` — every write is signed + published to the relay(s) and a forgery-surface
  report is collected; **what's displayed is unchanged**. Inspect from the browser
  console: `__signingReport()`. Use this first to watch coverage.
- `enforce` — reads return only your own signed writes plus writes from keys in your
  federation read-list (`VITE_HOLOSPHERE_READ_KEYS` / `addReadKey`). With an empty
  read-list you'll see only your own data — add the keys you trust. Turn on after
  `shadow` coverage is high.

The wiring is guarded (`typeof holosphere.enableSigning === 'function'`), so it is a
no-op against a holosphere build without signing.

## Scope & limits (Phase 1)

- **Durability + portability** for signed data. ✅
- **Shadow measurement** of the forgery surface (`shadow: true`). ✅
- **Authorized read** with a signed membership log + revocation-as-of-time
  (`enforce: true`). ✅
- **Not yet** (see the plan): `content` encryption (NIP-44) — signing proves *who
  wrote what* and now gates *what is displayed*, but does not yet hide content;
  relay write-policy/NIP-42; lens-scoped roles; hard (retroactive) revocation
  tombstones; cross-holon/federated authorization import.

Note: standard-kind projections (`projections.js`, see `NOSTR-BACKEND.md`)
are published beside each envelope but NEVER stored in the `_events`
sidecar — envelopes stay kind-30078 only, so `aggregate`/`authorizedView`
always parse `content` as the JSON record.

With relays configured the signer also runs the **reverse sync** (`reverse-sync.js`):
external edits of projected kinds by trusted keys are merged and re-signed as your
own 30078 write, so relay-backup mode gets mutual updates without switching wires.