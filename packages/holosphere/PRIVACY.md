# Private lenses — sealed content, keys handed out on purpose

A holon's records travel as signed kind-30078 events that any relay client
can read. A **private lens** keeps the envelope but seals its content: the
tags (holon, lens, item id, namespace, time) stay public so NIP-33
replacement, last-writer-wins, cursors and live subscriptions work exactly
as before; only `content` is NIP-44 ciphertext. The owner reads on every
device that holds their key, and hands a whole lens or a single item to a
pubkey. Nothing else changes for the reader: `get`, `getAll`, `subscribe`,
federated reads and holograms all return plaintext for what the instance
holds keys for, and nothing for the rest.

```
                    relay: tags in the clear, content sealed
   owner  ──put──►  { enc:'nip44', v:1, kid, ct, k }  ◄──get──  anyone
     │                                                            │
     │ vault (_vault/lens:<lens>, self-sealed)         keys table │
     │   lens keys (history), mode, grant ledger      received    │
     └────────── NIP-17 DM `holons/grant` ───────────► grantee ───┘
```

## The wire shape

```
content = JSON.stringify({
  enc: 'nip44', v: 1,
  kid: '<16 hex>',                    // sha256(lens key) prefix
  ct:  nip44(JSON(item), CEK),        // the item, under its own content key
  k:   nip44(hex(CEK), K_lens),       // that content key, under the lens key
})
```

- **Envelope encryption.** Every item has its own content key (CEK), wrapped
  under the lens key. Sharing the lens = sharing `K_lens` (opens every `k`).
  Sharing one item = sharing that item's CEK (opens only its `ct`). The CEK is
  stable across edits, so an item grant survives the owner's later writes.
- **`kid` is self-certifying.** A key someone hands you is accepted only if
  it hashes to the kid it claims; a bogus key cannot evict a real one.
- **Locked stubs.** A sealed event this instance cannot open lands in the
  store as `{ id, _locked: true, _kid }`. It is a record, so it supersedes an
  older plaintext claim at the same address (dropping the claim would leave
  that plaintext current). Reads hide stubs exactly like tombstones
  (`includeLocked: true` surfaces them); `store.rescan()` opens them in place
  once a key arrives and locks them again when the keys are gone.
- **Tombstones stay plain.** `{ id, _deleted: true }` says nothing but "gone".
- **What stays public:** lens names, item ids, timestamps, who signed, the
  existence of a record, hologram pointers to it. Nothing inside.

## The vault (owner recovery on any device)

Lens `_vault` of the holon, one replaceable record per private lens, id
`lens:<lens>`, sealed to the owner alone (`kid: 'self'`: the NIP-44
conversation key of the owner's key with its own pubkey). Plaintext:

```
{ id: 'lens:<lens>', lens, mode: 'private' | 'public',
  current: '<kid>', keys: [{ kid, key, at }],       // history kept for mid-rotation records
  grants: { [pubkey]: { lens?: { kid, at }, items?: { [id]: { at } } } } }
```

**The vault is the privacy flag**, not the public settings record. The
settings lens is last-writer-wins with enforcement off, so anyone could flip
`settings.privacy.lenses[lens]` to `public`; the owner's next write would
then go out in the clear. `settings.privacy` is only a hint so surfaces
without a key can show a lock. `@holons/core/privacy` keeps the two in step.

`login()` reloads the keyring for the new identity; `logout()` drops it,
locks every sealed record again and compacts the store so no plaintext
lingers in IndexedDB.

## Grants

A grant is a NIP-17 gift-wrapped DM (`nostr-dm.js`, subject `holons/grant`):

```
{ t: 'holons/grant', v: 1, id, holon, lens, kid,
  key?:  '<hex K_lens>',              // a lens grant
  item?: '<id>', cek?: '<hex CEK>',   // an item grant
  at }
```

The instance subscribes to its own gift wraps as soon as the transport is
up (`nostr.grants !== false`) and accepts them automatically: the key is
validated (kid self-certification, or the CEK must open the record it
claims), kept in the store's `keys` table sealed to the recipient's own key,
copied into the recipient's personal-holon vault (`_vault/grant:<holon>:<lens>`)
so their other devices recover it, and the lens is re-decoded.

**Who sent it matters as much as the key.** A grant is accepted only from a
sender that speaks for the holon: the holon itself (a personal holon is its
key), its *anchor* (the genesis of its signed `_members` log, else the
earliest `settings` envelope that declares a `holonPubkey` and is signed by
that key — see `authority.js`), or a current member of its log. An app can
replace that rule (`config.privacy.acceptGrantFrom`; core wires the same
authority its reads use). A grant with no sender, or from a stranger, is
dropped; an out-of-band grant the user chose to take is accepted with
`acceptGrant(payload, sender, { trusted: true })`. A lens this identity
owns never takes a foreign lens key (its vault *is* the key). And a key
handed to you means the lens is private: a grantee's own edits are sealed
even when it holds every key and sees no locked stub.

**A planted envelope never picks the content key of an edit.** Any key can
write to a relay, so the record found at an address is re-used as the base
of an edit only when a trusted author signed it: the owner trusts itself and
the keys in its grant ledger; a grantee trusts the keys that may grant.
Otherwise the edit gets a fresh content key under the owner's current lens
key (or, for a grantee, under the newest lens key it was handed).

**Who is a grantee?** A pubkey. `@holons/core/privacy` resolves "share with
holon X": a personal holon's id *is* its key; a group holon resolves to its
anchor (the genesis of its `_members` log, else the earliest self-signed
`holonPubkey` declaration — never the current settings record, which anyone
could have written last); anything else is refused with a clear message. A group holon's members read through their
own derived keys: the bot grants every private lens it owns to each member
key on its membership sync.

## Revocation is forward-only

`revokeLens` rotates the lens key **and every item's content key** (a lens
grantee could have cached them all), rewrites every item sealed under the
new keys, and re-grants the remaining grantees. `revokeItem` rotates that
item's content key and rewrites it. What a revoked party already read stays
read — nothing on a relay can un-read a message. A rotation over many items
runs sequentially and advances `nextCreatedAt` one second per write.

## What is never private

`settings`, `_vault`, `_members`, `users`, the global tables, append-only
logs (kind 1808 stays plaintext) and lenses carried on a standard Nostr kind
(a sealed NIP-52 event is not a NIP-52 event). A sealed write emits **no
standard-kind projection** and the reverse sync ignores private lenses; the
REA ledger (`rea_events`, plaintext) is not produced for a sealed record.
Password lenses (`store/private.js`) are unchanged: local-only, never on the
wire.

## Limits

- NIP-44 caps plaintext at 65 535 bytes and relays reject events around 64
  KB: `sealItem` refuses ciphertext over 60 KB.
- A relay may not retain gift wraps forever; the vault copy is what a fresh
  device recovers from, so a grant is durable once the grantee's instance
  has accepted it once.
- A device key that never saw the lens's vault, hint or a sealed record
  writes in the clear; one that saw any of them refuses (`no key for …`).
- A hologram pointer into a private lens resolves only for holders of a
  key; a detached copy (`propagate` with `useHolograms: false`) is refused.

## API

Instance: `hs.privacy` — `setLensMode`, `isPrivateLens`, `ensureKeys`,
`grantLens`, `grantItem`, `revokeLens`, `revokeItem`, `listGrants`,
`acceptGrant`, `ownedLenses`; `hs.isPrivateLens(holon, lens)`;
`put(..., { privacy: 'private' | 'public' })` overrides one write;
`get`/`getAll(..., { includeLocked: true })` surfaces stubs.
Store: `keysPut/keysGet/keysList/keysDelete`, `rescan`, `setUnseal`,
`isLocked` (`store/sealed.js` holds the codec).
Domain rules and the settings hint: `@holons/core/privacy`.
