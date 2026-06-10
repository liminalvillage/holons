# Signing (Phase 1) — sign-on-write + relay persistence

Opt-in NIP-01 signing for HoloSphere. When enabled, every `put` also publishes a
**signed Nostr event** to your relay(s), so your data is durable beyond GunDB and
portable across relays. Non-breaking: the Gun store is unchanged; signed events are
published alongside. Design & roadmap: [`NOSTR-SIGNING-PLAN.md`](./NOSTR-SIGNING-PLAN.md).

Requires the optional `nostr-tools` dependency (loaded lazily, only when enabled).

## Quick start

```js
import HoloSphere from 'holosphere';
import { generateSecretKey } from 'holosphere/nostr-events.js';

const sphere = new HoloSphere({
  appName: 'my-app',
  privateKey: generateSecretKey(),            // your actor key
  gunOptions: { /* peers, file, … */ },
});

await sphere.enableSigning({
  relays: ['wss://relay.example.com'],         // one or more Nostr relays
});

// Writes as usual — now also signed + published to the relay(s):
await sphere.put('89283082803ffff', 'tasks', { id: 'task-1', title: 'Repair the well' });
```

Without `enableSigning()` nothing changes — signing is strictly opt-in.

## Recover after data loss

If GunDB loses its local data, pull it back from the relay (signatures are
re-verified; forgeries dropped):

```js
const { found, restored } = await sphere.rehydrate('89283082803ffff', 'tasks');
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
stores its signed event in a reserved `_events` sidecar in Gun (invisible to normal
reads), and reads classify every item as **accounted** (backed by a valid signature)
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

## Authorized read (Phase 2) — collapse through authorized keys

With `enforce: true`, reads no longer return raw Gun items — they return the
**authorized view**: for each item, the latest claim from a key that was authorized
*at the time it signed* wins; everything else (unsigned, invalid, or from a
non-member) is dropped to a **pending** view. The raw store is untouched (open
graph); enforcement happens entirely at read time.

The authorized-key set per holon is itself a **signed `_members` log** rooted at a
genesis key. Anyone can write to it; only events authored by an admin-at-the-time
take effect when the log is folded. Revocation is **as-of-time**: removing a key does
not invalidate what it signed while it was a member.

```js
await sphere.enableSigning({ relays: ['wss://relay'], enforce: true });

// found the holon — your key becomes the genesis admin:
await sphere.foundHolon(holon);

// authorize others (only effective if you're an admin):
await sphere.addMember(holon, theirPubkey);            // or role 'admin'
await sphere.removeMember(holon, theirPubkey);

await sphere.getMembers(holon);   // Map(pubkey -> 'admin' | 'member')

// reads are now filtered to authorized, signed claims:
const tasks   = await sphere.getAll(holon, 'tasks');   // authorized view
const dropped = await sphere.getPending(holon, 'tasks');// unsigned / unauthorized / invalid
```

If you don't found the holon yourself, pin the trust anchor you were given:
`sphere.setGenesis(holon, genesisPubkey)` (otherwise genesis is TOFU = the earliest
self-signed genesis event).

## API

| Method | Purpose |
|---|---|
| `await sphere.enableSigning({ privateKey?, relays?, shadow?, enforce?, storeEnvelope?, verbose? })` | Turn on sign-on-write + dual-publish; `shadow` = measure, `enforce` = authorized read |
| `await sphere.foundHolon(holon)` | Self-sign the genesis membership event (you become admin) |
| `await sphere.addMember(holon, pubkey, role?)` / `removeMember(holon, pubkey)` | Modify the signed membership log (admin-gated) |
| `await sphere.getMembers(holon)` | Current authorized set → `Map(pubkey -> role)` |
| `await sphere.getPending(holon, lens)` | Items hidden by enforce-mode (unsigned/unauthorized/invalid) |
| `sphere.setGenesis(holon, pubkey)` | Pin the trusted genesis pubkey |
| `sphere.disableSigning()` | Stop signing, close relay connections |
| `sphere.signingEnabled` | Boolean |
| `sphere.getSigningRelays()` / `sphere.setSigningRelays(list)` | Read / replace relay set |
| `await sphere.rehydrate(holon, lens)` | Restore a holon/lens from relays into Gun |
| `await sphere.migrateRelays({ to, from?, filter?, switch? })` | Move/mirror signed data across relays |
| `await sphere.auditLens(holon, lens)` | Shadow-audit a lens (accounted vs would-drop); output unchanged |
| `sphere.getShadowReport()` / `sphere.resetShadowReport()` | Cumulative shadow stats |

## Using it in the harvest dashboard

The web dashboard (`apps/web`) wires signing onto the instance it builds, controlled
by env (default **off** — no behavior change):

```bash
# apps/web/.env
VITE_HOLOSPHERE_SIGNING=shadow            # off (default) | shadow | enforce
VITE_HOLOSPHERE_RELAYS=wss://relay.example.com,wss://relay2.example.com   # optional
```

- `shadow` — every write is signed + published to the relay(s) and a forgery-surface
  report is collected; **what's displayed is unchanged**. Inspect from the browser
  console: `__signingReport()`. Use this first to watch coverage.
- `enforce` — reads return only authorized, signed items. **Requires a membership log
  per holon** (`foundHolon` / `addMember`) or lenses will look empty — turn on
  deliberately, after `shadow` coverage is high.

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
