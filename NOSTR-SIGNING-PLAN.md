# HoloSphere × Nostr — Signed Events & Authorized-Read Plan

**Status:** Design RFC / roadmap
**Author:** Holons core
**Scope:** `holosphere` (signing, verification, read-collapse), `@holons/core` (authorization policy, reducers), `holonsbot` + `apps/web` + `mcp-ui` (key custody)

---

## 1. Thesis: permissionless write, authorized read

GunDB is an open peer-to-peer graph. You **cannot** prevent a peer from writing a
record — any client with the relay URL can `put` anything anywhere. Every audit of
the current stack confirms this: writes are unsigned, identity is a self-asserted
string, `canWrite()` is never called on the write path, and a custom client can
forge any actor.

So we stop fighting it. We adopt the **Nostr model**:

> The relay (here: the GunDB graph) accepts everything. **Truth is not what was
> written — it is what a reader can cryptographically verify and is authorized to
> count.** Every record is a signed event. What a holon *displays and accounts for*
> is a deterministic collapse of the signed event set, filtered through the set of
> keys that holon authorizes.

This gives us the property the user articulated:

- **Everyone can write everything, everywhere** — storage stays open, offline-first,
  censorship-resistant, exactly as GunDB is today.
- **What is finally displayed is filtered and collapsed through authorized keys** —
  reads verify signatures, drop forgeries, keep only events from keys the holon
  recognizes, and fold them into the canonical view.

HoloSphere becomes, in one line: **Nostr events over a GunDB graph addressed by H3.**

This single change converts the platform's #1 production blocker (unenforceable
authorization) from a write-time problem we *can't* solve in P2P into a read-time
problem we *can* solve with signatures.

---

## 2. What already exists (and what's missing)

The building blocks are present but disconnected.

| Capability | Status | Location |
|---|---|---|
| secp256k1 keygen, x-only pubkey, npub/nsec bech32 | ✅ exists | `holosphere/nostr-utils-shim.js` |
| `privateKey` → `client.publicKey` on construct | ✅ exists | `holosphere/holosphere.js:51–66` |
| `_allowedAuthors` set + `addAllowedAuthor/remove/get` | ✅ exists (in-memory only) | `holosphere/holosphere.js:133,520–563` |
| `canWrite(holon, lens, actingAs)` policy check | ✅ exists, **never called by `put`** | `holosphere/holosphere.js:520` |
| Per-holon `_capabilities` registry | ✅ exists | `holosphere/registry-shim.js` |
| Federation handshake over GunDB DMs (authorizes partner key) | ✅ exists | `holosphere/handshake-shim.js:165–246` |
| `writeWithIdentity` / `canWriteToHolon` (UI gating only) | ✅ exists, advisory | `harvest/packages/core/src/holosphere/{write,identity}.ts` |
| **Schnorr event signing / verification (NIP-01)** | ❌ **missing** | — |
| **Signed envelope as the storage payload** | ❌ missing | — |
| **Verify + authorize + collapse on read** | ❌ missing | — |
| **Persisted, signed, revocable membership log** | ❌ missing (only an in-memory Set) | — |
| **Federation that re-verifies and re-authorizes imports** | ❌ missing | — |

`@noble/curves` (already a dependency) ships `schnorr.sign`/`schnorr.verify`, so the
crypto is a thin addition, not a new dependency.

---

## 3. The signed event (envelope)

Every HoloSphere item becomes a **NIP-01 event**, using **NIP-33 parameterized-
replaceable** semantics so each author has exactly one current claim per item.

```jsonc
{
  "id":        "<sha256 of the serialized event>",   // NIP-01 id
  "pubkey":    "<author x-only pubkey, hex>",          // who signed
  "created_at": 1733829600,                            // unix seconds (logical clock)
  "kind":      30078,                                  // app-specific replaceable (NIP-78/33)
  "tags": [
    ["h", "<holonId>"],        // holon: H3 cell or string id
    ["l", "<lens>"],           // lens: tasks | rea_events | proposals | ...
    ["d", "<itemId>"],         // replaceable key: (pubkey, kind, d) is unique
    ["ref", "<itemId>"]        // optional: references to other items/events
  ],
  "content":   "<JSON item payload, or NIP-44 ciphertext for private lenses>",
  "sig":       "<schnorr signature over id>"
}
```

- **`(pubkey, kind, d)`** uniquely identifies *one author's current claim* about an
  item. A newer `created_at` from the same author replaces the older one — no
  clobber across authors, because different authors live at different keys.
- **`content`** holds today's item JSON unchanged. Domains keep their shapes; the
  envelope wraps them.
- The **item `id`** the system already uses (`data.id`) becomes the `d` tag.

### Storage mapping (the one breaking change)

Today: `appname / holon / lens / itemId → payload` (single slot, last-write-wins
across *all* writers → the clobber bug).

New: nest each author's signed claim under the item so concurrent claims coexist:

```
appname / holon / lens / itemId / <pubkey> → <signed event>
```

All claims survive in storage ("everyone writes everywhere"); the **read collapse**
(§5) decides which one counts. Legacy single-slot data is read through a
compatibility shim during migration (§8, Phase 1).

---

## 4. Identity & keys

Every **actor is a Nostr keypair**. The pubkey is the identity that today's
`author`/`createdBy`/`actingAs` strings only *claimed*.

| Surface | Key custody | Mechanism |
|---|---|---|
| Web dashboard | Self-custody (preferred) | NIP-07 browser extension, or generated + stored (`apps/web/scripts/generate-nostr-key.js`, `keyStorage.ts`) |
| Telegram bot | Custodial by default | `KeyManager` holds per-user keys; delegated signing (NIP-26) so the bot signs *as* the user within scope |
| MCP / AI agent | Service key + delegation | Agent signs with its own key, authorized as a member or delegate |
| CLI | Local `nsec` in env/keystore | `parseNsecOrHex` already supports this |

**Custodial keys are a real risk** (the server can sign as the user). Mitigations:
scope delegation tokens narrowly (lens + expiry), store them in `_capabilities`,
and offer a "claim self-custody" upgrade that rotates the user to a key the server
never holds. Custodial-now / self-custody-later is an explicit, supported path, not
a dead end.

---

## 5. The read pipeline: verify → authorize → collapse

This is where "filtered and collapsed through authorized keys" happens. It replaces
the raw `getAll` (`content.js:719–831`) with a staged pipeline:

```
getAll(holon, lens):
  1. FETCH    all signed events under holon/lens (every author's claim per item)
  2. VERIFY   schnorr-verify each event; drop invalid sigs.            [holosphere]
              (cache verified event ids — verification is the hot path)
  3. AUTHORIZE resolve the authorized-key set for (holon, lens, asOf)  [core policy,
              from the membership log (§6); keep only events whose       injected
              pubkey holds the capability this lens requires.            callback]
  4. COLLAPSE  per itemId, fold the surviving events into one value:    [core reducer]
                - default   → latest created_at wins
                - counters  → deterministic sum/CRDT fold (§7)
                - governance→ tally authorized votes
  5. RETURN   the "accounted view".
              Unauthorized/invalid events are NOT deleted — they remain
              in storage and are exposed via a separate `pending` view
              for onboarding, moderation, and dispute.
```

**Division of responsibility (respects `@holons/core`'s "core owns meaning" rule):**
`holosphere` owns steps 1–2 (fetch + signature verification) and the collapse
*machinery*; `@holons/core` owns steps 3–4's *policy* — which keys are authorized
for which lens/role, and the per-lens reducer. The policy is injected into the
holosphere read as a callback so the library never hard-codes domain meaning.

Because unauthorized events are *inert but retained*, the system is forgiving: a
brand-new member's writes sit in `pending` until an admin authorizes their key,
then retroactively count — no data loss, no gatekeeping at write time.

---

## 6. Authorization: the membership log

"Authorized keys" cannot be an in-memory `Set` (today's `_allowedAuthors`) — it must
be **persisted, signed, scoped, and revocable**, and itself verifiable by anyone.
So the authorized-key set is *also* a collapsed log of signed events.

- **Genesis.** When a holon is created, a **genesis key** is recorded as the root of
  trust (the founder's pubkey, or a designated steward npub). Genesis is
  self-authorizing — it is the base case of the collapse.
- **Membership events** live in a reserved lens (`_members`) as signed events of kind
  `membership`:
  ```jsonc
  { "op": "add", "pubkey": "<member>", "role": "steward|member|...",
    "lenses": ["tasks","rea_events"], "expires_at": 0 }
  ```
  Authored only by keys that already hold the `admin/steward` capability (rooted at
  genesis). `remove` revokes.
- **The authorized set** for `(holon, lens, asOf)` is the §5 pipeline run over
  `_members`, bootstrapped at genesis. (The pipeline authorizes itself — the same
  fold, with genesis as the axiom.)
- **Delegation (NIP-26).** A steward delegates signing to a bot/service key for
  custodial UX. Delegation tokens go in the existing `_capabilities` registry
  (`registry-shim.js`) with lens scope + expiry.

This is the **formalization of what already half-exists**: the federation handshake
already calls `addAllowedAuthor(partnerPubKey)` (`handshake-shim.js:188,235`). We
turn that in-memory grant into a signed `_members` event — persisted, auditable,
revocable, and federatable.

**Mapping to the existing conceptual model:** `_members` *is* the holon's **membrane**
and **zones** made enforceable; the membership log *is* the operative part of the
**DNA**; **Council** votes become signed events tallied across authorized members.
The docs' vocabulary stays; it now cashes out in cryptography.

---

## 7. Counters, balances & governance integrity

The audit's #4 risk — concurrent writes to a balance silently clobber under GunDB
last-write-wins — dissolves under event-sourcing:

- A monetary lens (`rea_events`, funding buckets) is a set of **signed, append-only
  events**. The balance is a **deterministic fold** over the authorized subset, not a
  mutable slot. Two concurrent payouts produce two events; both survive; the reducer
  sums them. No race, no clobber.
- A governance lens (`proposals`) tallies **one signed vote per authorized member**;
  duplicate or unauthorized votes are dropped at step 3/4.
- This authorized event log is also the **clean bridge to the on-chain layer**
  (`holons/contracts/Splitter.sol`): on-chain splitter shares can be derived from the
  same deterministic fold, so off-chain accounting and on-chain settlement stop being
  two disconnected systems.

---

## 8. Federation: trustless by construction

Today federation propagates data into the public graph with no signatures, so a
malicious peer can forge a partner or inject into federated lenses
(`federation.js:920`). Signed events fix this with **no new trust in the relay**:

- **Propagate raw signed events.** The signature travels with the event, so it is
  verifiable anywhere. Soul references / holograms resolve to a *verifiable* source,
  not a trusted one.
- **The importing space re-verifies and re-authorizes.** A received event is counted
  only if (a) its signature verifies and (b) its pubkey is in the *importer's*
  authorized set for that lens. "Only specific messages are visible/accounted for" =
  the importing holon's own membership policy applied to the partner's events.
- **Recognizing a partner** = importing their membership root (or specific delegated
  keys / a `_capabilities` token) into your policy. The handshake already exchanges
  pubkeys; it now exchanges *authorization*, signed.
- **Injection becomes inert.** A hostile peer can still *write* into a federated lens
  (open graph), but unauthorized events never survive the collapse. Forgery requires
  a private key the attacker does not have.

---

## 9. Confidentiality is a separate track (be honest)

Signing proves *who* and *what*; it does **not** hide content. The audit's #2 risk —
everything on the relay is world-readable — is **not** fixed by this plan.

For private holons (family system PII, volunteer records), layer **NIP-44** encryption
on `content` (and optionally **NIP-59** gift-wrap to hide metadata). This is an
orthogonal workstream that composes cleanly with the envelope: encrypt `content`
before signing; authorized readers hold the decryption capability. Tracked
separately so it doesn't block the signing rollout.

---

## 10. Integration points (file:line)

| Change | Where |
|---|---|
| Add `signEvent`, `verifyEvent`, `getEventHash` (schnorr via `@noble/curves`) | `holosphere/nostr-utils-shim.js` (new exports) |
| Build + sign envelope before write; nest storage by pubkey | `holosphere/content.js` `put` (`:182`, write at `:513`) |
| Verify → authorize(callback) → collapse pipeline | `holosphere/content.js` `getAll`/`get` (`:719–831`, `:555`) |
| Evolve `_allowedAuthors`/`canWrite` into the read-side authorized-set resolver | `holosphere/holosphere.js:520–563` |
| Inject policy + reducers; `actingAs` → signing key; make denial real | `harvest/packages/core/src/holosphere/{identity,write}.ts` |
| New core domain: membership log, roles, reducers (owns §6/§7 meaning) | `harvest/packages/core/src/membership/` (new) |
| Carry signed events; verify + authorize on import | `holosphere/federation.js` `propagate` (`:920`), `getFederated` (`:611`), `subscribeFederation` (`:197`) |
| Delegation tokens (NIP-26) | `holosphere/registry-shim.js` `_capabilities` |
| Membership grant on accept (replace in-memory `addAllowedAuthor`) | `holosphere/handshake-shim.js:188,235` |
| Per-user key custody + delegated signing | `harvest/packages/telegram-ui/src/KeyManager.js`, `apps/web` key scripts, `mcp-ui` |

---

## 11. Phased roadmap

**Phase 0 — Crypto & keys (foundation, no behavior change).**
- Add `signEvent`/`verifyEvent`/`getEventHash` to the nostr shim, with NIP-01 test
  vectors. Provision keys on every surface (web NIP-07/generated, bot custodial via
  `KeyManager`, MCP service key, CLI `nsec`). Ship dormant.

**Phase 1 — Sign on write + relay persistence.** ✅ *Implemented (non-breaking cut) —
see [`SIGNING.md`](./SIGNING.md), `signing.js`, `nostr-events.js`, `test/signing.test.js`.*
- Every `put` also publishes a signed event to the configured relay(s) (opt-in via
  `sphere.enableSigning()`); the Gun store is unchanged (raw items), so nothing
  breaks. Adds `rehydrate()` (relay → Gun recovery) and `migrateRelays()` (move/mirror
  signed data across relays). Validated against real strfry.
- Signed envelopes are also stored locally in a reserved `_events` Gun sidecar
  (invisible to normal reads), and **shadow mode** (`enableSigning({ shadow: true })`)
  classifies every read as accounted vs would-drop — measuring the forgery surface
  **without changing output**. `auditLens()` + `getShadowReport()` expose the numbers.
  Watching `wouldDrop → ~0` as clients adopt signing is the go signal for Phase 2.

**Phase 2 — Authorized read goes live.** ✅ *Implemented — see [`SIGNING.md`](./SIGNING.md)
"Authorized read", `signing.js` (`authorizedView`), `test/federation-read.test.js`
(default) + `test/authorize.test.js` (membership).*
- **Default — federation read-list** (`enforce: true`): reads collapse to the latest
  claim from a key *you* trust — your own key plus your federation list
  (`_allowedAuthors`, also fed by the federation handshake). Reader-scoped,
  current-list (the Nostr follow model). API: `addReadKey` / `removeReadKey` /
  `getReadKeys`; unsigned/untrusted/invalid → `getPending`.
- **Optional — holon authority** (`enforce: 'membership'`): the signed `_members` log
  (genesis + admin-gated add/remove) folded as-of-time, for when the *space* (not the
  reader) defines who may write. API: `foundHolon` / `addMember` / `removeMember` /
  `getMembers` / `setGenesis`.
- Wired into the harvest dashboard (`apps/web`, env-driven) and validated through the
  real `@holons/core` factory.
- *Still to do:* signed/portable read-list (NIP-02 contact list), core-domain home,
  lens-scoped roles, federated read-list import (Phase 3).

**Phase 3 — Trustless federation.**
- Propagate signed events; exchange + import membership roots/capabilities on
  handshake; verify and re-authorize all imported events; holograms resolve to
  verified sources. Closes the federation forge/inject risk.

**Phase 4 — Reducers, encryption, hardening.**
- Event-sourced reducers for monetary/governance lenses (§7); key rotation &
  revocation semantics; NIP-44 encryption for private lenses (§9); GC/pruning &
  optional NIP-13 proof-of-work to bound open-write spam; migrate/backfill legacy
  unsigned data (sign-on-touch + admin backfill); derive on-chain splitter shares
  from the authorized fold.

---

## 12. Open decisions

1. **Kind numbering** — NIP-78 `30078` app-data vs a dedicated parameterized-
   replaceable range (`30000–39999`) with `d` = itemId. *Recommend NIP-33
   parameterized-replaceable.*
2. **Authorize-as-of-time vs retroactive** — count an event if its author was
   authorized *at `created_at`* (no retroactive invalidation), with explicit
   tombstones for hard repudiation. *Recommend as-of-time.* Avoids history rewriting
   when a key is later revoked.
3. **Custody model** — custodial-default with scoped delegation, upgradable to
   self-custody. Decide the default for each surface.
4. **Multi-claim storage & GC** — nest by pubkey (one current claim/author, cheap) vs
   by event-id (full history, heavier). Decide retention/pruning for unauthorized
   spam.
5. **Collapse reducers per lens** — default LWW; which lenses need sum / CRDT / vote-
   tally, defined in core.
6. **Where genesis comes from** — founder key, H3-cell-derived key, or designated
   steward npub, per holon type.

---

## 13. What this fixes — and what it doesn't

**Fixes (from the production-gap audit):**
- ✅ **#1 Enforceable authorization** — reads are authoritative; forged/unauthorized
  writes are inert. The crux gap closes.
- ✅ **#4 Counter/balance integrity** — event-sourced folds replace clobbering slots.
- ✅ **Federation forge/inject** — signatures + re-authorization make injection inert.
- ✅ **Trustless soul references** — holograms resolve to verifiable events.

**Does NOT fix (separate tracks — stated plainly):**
- ❌ **#2 Confidentiality** — needs the NIP-44 encryption track (§9).
- ⚠️ **#5 Operational durability/ops** — *largely addressed* once events are relay-
  persisted (§14): GunDB data loss stops being fatal because the relay is the durable
  system-of-record. CI, observability, and bounded `getAll`/`compute` remain their own
  workstream.
- ❌ **#3 Automation primitives** — threshold-trigger engine and the off-chain→settlement
  bridge are independent (though §7 makes the bridge much cleaner).

**Net:** this plan turns HoloSphere from "open graph anyone can corrupt" into "open
graph where only signed, authorized events count" — the single highest-leverage
change toward production, and the precondition for trustworthy money and governance.

---

## 14. Persistence & durability via Nostr relays

Because every record is now a signed NIP-01 event, it is **relay-portable by
construction**. A Nostr relay is purpose-built to be a durable, replicated,
queryable store of signed events — exactly what HoloSphere needs and exactly what
GunDB's radisk (local files, no backups, observed data loss) is not. This directly
answers the "GunDB will lose data" risk.

### Dual-transport over one shared unit

The signed event is the common unit between two transports that are now **replicas,
not rivals**:

| Layer | Role | Strength |
|---|---|---|
| **GunDB** | live P2P sync, offline-first local cache, gossip | real-time, offline, serverless |
| **Nostr relay(s)** | durable canonical store, cross-device sync, backfill/recovery | persistent, replicated, queryable, mature |

Events are **content-addressed** (`id` = event hash) and **self-verifying** (`sig`),
so writing the same event to both layers is idempotent and merging them cannot
conflict: take the union, dedup by `id`, run the §5 collapse. The deterministic fold
makes multi-source reconciliation trivial.

### Write / read / recover

- **Write** → sign once; publish to GunDB (fast, local, P2P) *and* `EVENT` to the
  relay(s) (durable). Idempotent by `id`.
- **Read** → `REQ` the relay (durable/authoritative) ∪ GunDB (recent/offline) → dedup
  by `id` → verify → authorize → collapse. Same pipeline, two sources.
- **Recover / backfill** → if GunDB loses data, rehydrate from the relay by tag query;
  a device offline for a week backfills on reconnect. **Data loss stops being fatal.**

### Addressing maps natively

The envelope tags (§3) are already the relay's query surface:

| HoloSphere operation | Nostr relay query |
|---|---|
| all items in a holon/lens | `{"#h":[holonId], "#l":[lens]}` |
| one item's author-claims | `{"#h":[holonId], "#l":[lens], "#d":[itemId]}` |
| H3 roll-up across children | `{"#h":[child1, child2, …]}` (H3 supplies the child set) |
| live subscription | `REQ` subscription (replaces/augments Gun `subscribe`) |
| per-author current claim | NIP-33 `(pubkey, kind, d)` — resolved **natively** by the relay |

NIP-33 keeps exactly **one current claim per author**, which is precisely the
multi-author model the collapse expects — no relay-side logic fights our design.

### Deployment

- Run **your own relay** (e.g. `strfry` on LMDB, or a Postgres-backed relay) on a
  mounted volume with automated backups → durable system-of-record.
- **Mirror to public relays** for extra replication and censorship-resistance.
- Restrict *writes* to your relay with **NIP-42 auth / allow-lists / NIP-13 PoW** if
  storage-spam is a concern — open-read stays open. (Authorized-read already makes
  unauthorized events inert; this is just a storage-bloat optimization.)

### Trust model (relays can omit, not forge)

A relay holds no keys, so it **cannot forge or alter** events — tampering breaks the
signature and the event is dropped on read. A relay *can* withhold or serve stale
data. Mitigation is standard Nostr practice: query **multiple relays + GunDB**, and
keep truth **client-verified**. This is a strictly stronger trust posture than
today's "trust the single GunDB relay."

### Caveats

- **Large aggregations** need filter batching (relays cap filter size / response
  counts); page the child set for big H3 roll-ups.
- **Metadata privacy**: tags reveal *which* holon/lens even when `content` is NIP-44
  encrypted. For sensitive holons, wrap in **NIP-59 gift-wrap** so tags don't leak.
- **Deletion** (NIP-09) is advisory — relays may retain. True erasure (GDPR) still
  requires running relays you control with an enforced delete policy; public mirrors
  may keep copies. Encrypt-then-publish + key-destruction ("crypto-shredding") is the
  realistic erasure story for mirrored data.
- You now operate a relay — but that is **mature, purpose-built software with a real
  backup story**, replacing a bespoke radisk setup that has none.

### Effect on the roadmap

Folds into **Phase 1** (publish signed events to a relay alongside GunDB as soon as
signing lands) and **Phase 4** (relay as primary store, GunDB as the local-first
cache; write-policy hardening; crypto-shredding for erasure). It does **not** block
the auth work — relay persistence and authorized-read are independent wins that
compose.
```

