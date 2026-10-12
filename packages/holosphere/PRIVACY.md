# Private scopes — sealed content, keys handed out on purpose

A holon's records travel as signed kind-30078 events that any relay client
can read. A **private scope** keeps the envelope but seals its content: the
tags (holon, lens, item id, namespace, time) stay public so NIP-33
replacement, last-writer-wins, cursors and live subscriptions work exactly
as before; only `content` is NIP-44 ciphertext. Nothing changes for the
reader: `get`, `getAll`, `subscribe`, federated reads and holograms all
return plaintext for what the instance holds keys for, and nothing for the
rest.

Five rules say all of it:

1. **A scope is a lens or one item of it** — `{ holon, lens }` or
   `{ holon, lens, item }`. A locked lens covers its items; a card is locked
   on its own only while its lens is public (locking the lens folds the
   cards' own vaults: one scope governs).
2. **A scope is private exactly when its vault record exists** —
   `_vault/<lens>` or `_vault/<lens>/<item>` in the holon, content sealed to
   the owner, tags public. Every instance can see the flag; no settings
   hint, no heuristics. `lock` creates the record and rewrites the scope
   sealed; `unlock` rewrites it in the clear and tombstones the record.
   A rewrite covers what the owner *sees*: under enforced reads a record
   the holon's authority rejects (unsigned, by a never-seated key, a stray
   revival over a signed delete) is left alone — re-signing it would
   publish it as the owner's own.
   **The vault obeys the one capability table** (`capabilities.js`): a vault
   record counts from a *member* of the holon, and only a tombstone by its
   own author or by an *admin* retires it. A stranger can neither lock a
   holon's lens nor flip a locked one back to plaintext by writing last.
   An admin who holds the key (a member shared with) may `unlock` what
   another key locked, or take it over (`@holons/core/privacy` `takeOver`:
   unlock, then lock under their own vault); the role comes from
   `config.privacy.roleOf` — core wires the same rule its reads use.
3. **One key per scope.** `content = { enc:'nip44', v:2, kid, ct }` with
   `ct = nip44(JSON(item), K_scope)` and `kid = sha256(K_scope)[0:16]`.
   Rotation = a new key in the vault + the scope's items rewritten + the
   key resent to whoever stays.
4. **Who may read is a list the domain layer keeps on the vault**
   (`audience`, opaque here — `@holons/core/privacy` stores holons in NIP-51
   vocabulary) and **who holds which key** is `sent: { [pubkey]: kid }`.
5. **A key reaches a reader as a NIP-17 DM** (`holons/grant`), accepted only
   from a sender that speaks for the holon, and kept in the reader's own
   personal-holon `_vault` so every device of theirs recovers it.

```
                    relay: tags in the clear, content sealed
   owner  ──put──►  { enc:'nip44', v:2, kid, ct }     ◄──get──  anyone
     │                                                            │
     │ vault _vault/<lens>[/<item>] (self-sealed)       keyring   │
     │   keys (history), audience, sent                 copies    │
     └────────── NIP-17 DM `holons/grant` ───────────► reader ───┘
                                           reader's _vault/grant:<holon>:<lens>[:<item>]
```

## The vault

One record per private scope, in the owner holon, sealed to the owner alone
(`kid: 'self'`: the NIP-44 conversation key of the owner's key with its own
pubkey). Plaintext:

```
{ id: '<lens>' | '<lens>/<item>', scope: { holon, lens, item? },
  keys: [{ kid, key, at }],        // newest = current; history opens mid-rotation records
  audience: [...],                 // opaque to holosphere (core: [['group', id], ['p', hex], …])
  sent: { [pubkey]: kid } }        // which key each reader was last handed
```

A reader's copy of a grant has the same shape minus `audience`/`sent`, at
`_vault/grant:<holon>:<lens>[:<item>]` in the reader's personal holon.

`login()` reloads the keyring for the new identity; `logout()` drops it,
locks every sealed record again and compacts the store so no plaintext
lingers in IndexedDB. The flag itself survives: a vault record this
instance cannot open is a locked stub, and a stub is still a record.

## Locked stubs

A sealed event this instance cannot open lands in the store as
`{ id, _locked: true, _kid }`. It is a record, so it supersedes an older
plaintext claim at the same address (dropping the claim would leave that
plaintext current). Reads hide stubs exactly like tombstones
(`includeLocked: true` surfaces them); `store.rescan()` opens them in place
once a key arrives and locks them again when the keys are gone.
Tombstones stay plain: `{ id, _deleted: true }` says nothing but "gone".

## Grants

```
{ t: 'holons/grant', v: 2, holon, lens, item?, kid, key: '<hex K_scope>', at }
```

The instance subscribes to its own gift wraps as soon as the transport is
up (`nostr.grants !== false`) and accepts them automatically: the key must
hash to the kid it claims (self-certifying), the sender must speak for the
holon — the holon itself (a personal holon is its key), its *anchor* (the
genesis of its signed `_members` log, else the earliest `settings` envelope
that declares a `holonPubkey` and is signed by that key; see
`authority.js`), or a current member of its log; an app can replace that
rule (`config.privacy.acceptGrantFrom`, core wires the same authority its
reads use). A grant with no sender, or from a stranger, is dropped; an
out-of-band grant the user chose to take is accepted with
`acceptGrant(payload, sender, { trusted: true })`. A scope this identity
owns never takes a foreign key (its vault *is* the key).

A reader's own edit of a private scope is sealed under the newest key it
holds for that scope; its new item in a lens that is public goes out in the
clear. A stranger cannot overwrite a sealed card in plaintext: the vault
record says the scope is private and it holds no key (`no key for …`).

**Readers are pubkeys on the wire and nowhere else.** `@holons/core/privacy`
keeps an audience of *holons* per scope and resolves each to its reader keys:
a personal holon is its key plus the keys its signed profile links; a group
holon is the `p` tags of its NIP-29 state (kind 39001 admins + 39002
members) signed by its anchor. The owner holon is always in its own
audience, so members read everything private without being a special case.

## Revocation is forward-only

`revoke(scope, readers)` appends a new key, rewrites every item of the
scope under it and forgets the revoked readers; the domain layer then
`grant`s the new key to the readers that stay. What a revoked party already
read stays read — nothing on a relay can un-read a message. A rotation over
many items runs sequentially and advances `nextCreatedAt` one second per
write.

## What is never private

`settings`, `_vault`, `_members`, `users`, the global tables, append-only
logs (kind 1808 stays plaintext) and lenses carried on a standard Nostr kind
(a sealed NIP-52 event is not a NIP-52 event). A sealed write emits **no
standard-kind projection** and the reverse sync ignores private scopes; the
REA ledger (`rea_events`, plaintext) is not produced for a sealed record.
Password lenses (`store/private.js`) are unchanged: local-only, never on the
wire.

## Limits

- NIP-44 caps plaintext at 65 535 bytes and relays reject events around 64
  KB: `sealItem` refuses ciphertext over 60 KB.
- A relay may not retain gift wraps forever; the vault copy is what a fresh
  device recovers from, so a grant is durable once the reader's instance has
  accepted it once.
- A hologram pointer into a private scope resolves only for holders of a
  key; a detached copy (`propagate` with `useHolograms: false`) is refused.
- Records sealed under the v1 envelope (per-item content keys wrapped by a
  lens key, before 2026-10-01) are not readable by this codec; their owners
  lock the scope again from a device that still holds the plaintext.

## API

Instance: `hs.privacy` — `scopeOf`, `isPrivate`, `lockedScopes`, `owned`,
`ownedScopes`, `holdsKey`, `canManage`, `roleOf`, `may`, `lock`, `unlock`,
`audienceGet/Set`, `sentGet/Set`, `grant`, `revoke`, `acceptGrant`,
`ensureKeys`; `hs.isPrivate(holon, lens, item?)`;
`get`/`getAll(..., { includeLocked: true })` surfaces stubs.
Store: `rescan`, `setUnseal`, `isLocked` (`store/sealed.js` holds the codec).
Domain rules — who is in an audience and how a holon resolves to readers —
live in `@holons/core/privacy`.
