# The local store — a mirror of the relays

Holosphere keeps every record it has ever seen in a local, event-sourced
store (`store/`). The Nostr relays are the wire and the durable copy; the store
is what makes reads instant, subscriptions fire, and the app work offline.
Nothing else holds data any more — there is no graph database underneath.

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

## Tables

| table | key | value | durable |
|---|---|---|---|
| `records` | `holon\|lens\|id` (`_g` for globals) | `{ item, created_at, pubkey, eventId, origin }` — the CURRENT value at every address; tombstones (`item._deleted === true`) are kept | yes |
| `events` | event id | the signed envelope; only each author's latest claim per address (NIP-33) — except on an append-only lens, where every entry is its own address and all are kept. This is what signing/enforce and `getLog` read — the old `_events` sidecar is gone | yes |
| `private` | `scope\|lens\|key` | NIP-44 ciphertext of password lenses | yes |
| `keys` | `app\|recipient\|holon\|lens\|kid` (or `item:<id>`) | a received lens/item key for sealed content, sealed to the recipient's own key (see PRIVACY.md) | yes |
| `cursors` | `holon\|lens` | `{ since, syncedAt }` — how far the lens is synced | yes |
| `backlinks` | source soul | set of hologram-pointer souls | derived (rebuilt on open) |

## One ordering rule

`store.apply(event)` is the only place "which write is current" is decided
(`store/lww.js`): a newer `created_at` wins; on a tie the larger event id wins;
unsigned local writes (`putRaw`, empty event id) lose ties to signed events.
Re-applying an event id the store already holds is a no-op, so relay echoes
need no dedup set. Local writes always become current because `nextCreatedAt`
bumps one second past whatever is current when the clock has not moved
(relays keep the first of two equal timestamps).

## Append-only lenses

A lens registered as append-only (`appendLenses` in the store options, or
`registerAppendLens`) is carried on the **regular kind 1808** instead of the
replaceable envelope (`store/wire.js` `createAppendWire`, `log.js`). Every
event is its own record, addressed by its **event id**, so the ordering rule
above never meets a second claim at an address: nothing is superseded, nothing
is tombstoned, every verified entry is kept — in `records` and in `events`.
`put`/`delete` refuse such a lens; `append` / `appendSigned` add entries,
`getLog` / `subscribeLog` read them oldest first (ties by smaller id), each
with the author, time and `e`-tag refs (`prev`, `basis`, `attests`,
`disputes`). A replaceable envelope naming a log address is not a claim
(a forged tombstone cannot shadow an entry). What a log **means** — whose
entries count, what state they fold into — is the reader's reduce, not the
store's.

## Change feed

`store.watch(holon, lens, cb)` replays the current non-tombstone records on a
microtask (after the caller holds its unsubscribe handle), then delivers one
call per accepted change — tombstones included, with `meta.tombstone` — in
apply order. Every subscriber gets its own full replay; there is no
"first listener only" behaviour and no echo storms to guard against.

## Private lenses

A `password` on `put/get/getAll/delete` scopes the record to
`${appName}:${holon ?? lens}`. The key is `scrypt(password, scope, N=2^15, r=8,
p=1, 32 bytes)`, the payload `nip44.v2.encrypt(JSON(item), key)`. Private
records are never signed, published, propagated, indexed for holograms or
exported. A wrong password fails the NIP-44 MAC. **The KDF parameters are
frozen**: changing them orphans every existing private record.

## Sealed content

A private lens (PRIVACY.md) keeps the envelope's tags and seals only
`content`: `{ enc: 'nip44', v: 1, kid, ct, k }`. The wire's `decodeEvent`
recognises that shape BEFORE the plain path (a sealed payload has no `id`, so
the plain path would otherwise keep the ciphertext as an item) and hands it
to the store's `unseal` hook — the privacy layer's keyring. What opens
becomes an ordinary record; what does not becomes a **locked stub**
`{ id, _locked: true, _kid }`, a record like a tombstone: it supersedes older
plaintext at the address, `list()` and the watch replay hide it (`includeLocked`
/ `meta.locked` surface it), and `store.rescan({ holon, lens })` re-decodes
the winning event at every address so stubs open in place when a key
arrives and lock again when the keys are gone — watchers hear both.

## Adapters

| adapter | where | notes |
|---|---|---|
| `memory` | tests, serverless functions, one-shot scripts | nothing persisted; `{ retain: true }` keeps a copy so a second store on the same adapter hydrates (tests) |
| `indexeddb` | browsers | DB `holosphere:<app>`, one read-write transaction per batch; quota errors degrade to memory-only with a warning |
| `file` | Node | `<dir>/<app>.snapshot.json` + `<dir>/<app>.log.jsonl`; log replayed and compacted on open, and again after `compactAfter` ops (50 000); one process per directory |

`createStore({ appName, adapter: 'auto' })` picks IndexedDB when the platform
has it, memory otherwise. The file adapter is loaded lazily so browser bundles
never pull in `node:fs`.

## Sync cursors

The relay transport records, per `(holon, lens)`, the newest `created_at` it
has fully caught up to. A cold store backfills a lens with paginated
`limit`/`until` queries (relays cap a single response — strfry at 500); a warm
store asks only for `since: cursor − 60 s` and then keeps a live subscription
open. Cursors are set by the transport once a backfill is complete, never by
the store on its own, so a crash mid-backfill cannot skip history.

## Adapter interface

```ts
interface StoreAdapter {
  open(): Promise<Snapshot | null>;   // { records[], events[], private[], keys[], cursors[] }
  append(ops: Op[]): Promise<void>;   // rec | evt | evt-del | priv | priv-del | key | key-del | cur
  snapshot(full: Snapshot): Promise<void>;
  clear(): Promise<void>;
  close(): Promise<void>;
}
```
