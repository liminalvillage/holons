# Nostr interop — the shared contract

Three apps publish overlapping schedules to the same relays:

- **Elinor** — community shifts. External to this org; see [shifts-elinor.md](shifts-elinor.md).
- **Holons** — quests, events and the kiosk.
- **LibreSesh** — unconference programmes.

All three already speak NIP-52 and agree on the parts NIP-52 defines. This
document is the small set of rules on top of it that lets one relay carry all
three and lets any of them render the others.

Status: **draft**, 2026-09-08. Written against Elinor as documented,
`@holons/core` as it stands, and LibreSesh at `ca2a206`.

## The problem, precisely

Every app already emits `d`, `title`, `start`, `end`, `start_tzid` and
`location` the same way. Nothing is broken at the NIP-52 layer.

What breaks is that each app encodes *record identity* in its `d` tag, in its
own grammar, and each reader parses only its own:

| App       | `d` grammar                          | Reader                                  |
|-----------|--------------------------------------|-----------------------------------------|
| Elinor    | `shift-<groupId>-<date>-<code>`      | `parseShiftDTag` — `null` for the others |
| Holons    | `holons:<lens>:<holon>:<id>`         | `parseProjectionDTag` — `null` for the others |
| LibreSesh | `libresesh-<slug>-session-<id>`      | none; publishes only                     |

`packages/core/src/nostr/tags.ts:133` states the failure in its own doc
comment: *"`null` for any other grammar (e.g. Elinor's `shift-…`)"*. The
result is three schedules on one relay that cannot see each other, and there
is nothing a client can do about it from the outside.

## Rule 1 — `d` is opaque

**A reader MUST NOT parse another app's `d` tag.** Treat it as what NIP-01
says it is: an opaque identifier whose only job is to make
`(kind, pubkey, d)` addressable and therefore replaceable.

This is the rule everything else follows from, and it is the one that costs
nothing to adopt. The alternative — converging on a single grammar — is not
available: Elinor is external and will not change, and re-addressing anything
already published orphans it under an address no subscriber is watching. Each
app keeps the grammar it has.

## Rule 2 — the join key is `t: group-<id>`

**A published record MUST carry `['t', 'group-<id>']`** naming the community
it belongs to.

This is not new. Elinor emits it (`t:group-<groupId>`) and Holons emits it
(`groupTag()` → `group-<holon>`); the value is the Telegram chat id where one
exists, and any stable community identifier otherwise. It is already the
de-facto join key between the two, and it is what the kiosk's existing
subscription filters on (`packages/core/src/shifts/protocol.ts:384`).

Writing it down makes it a contract rather than a coincidence, and it is the
single tag that makes a schedule discoverable to a client that has never
heard of the app that published it.

## Rule 3 — provenance goes in a tag, not the `d`

**A published record MUST carry `['holons', <lens>, <holon>, <id>]`.**

- `lens` — the record type, from the shared vocabulary below.
- `holon` — the same community id as Rule 2, unprefixed.
- `id` — the publishing app's own record id, opaque to everyone else.

Holons already writes this tag in `commonTags()` and then ignores it,
parsing the `d` tag instead (`codecs/calendar.ts:173`). Rule 3 is mostly a
matter of readers starting to read what writers already write.

The tag is named `holons` for continuity: every event Holons has already
published carries it, so adopting the rule costs no republishing and breaks
no existing address. It is a cross-app contract with an awkward name, not a
claim of ownership — a future revision may add a vendor-neutral alias
alongside it.

### Lens vocabulary

| lens       | means                                    | published by       |
|------------|------------------------------------------|--------------------|
| `shifts`   | a recurring duty with capacity            | Elinor             |
| `quests`   | a task with a time                        | Holons             |
| `events`   | a gathering                               | Holons, LibreSesh  |
| `sessions` | one slot in a conference programme        | LibreSesh          |

A reader that does not know a lens MUST ignore the record rather than guess.

## Rule 4 — trust is explicit, per community

**A reader MUST NOT ingest a record from a pubkey it has not been told to
trust for that community.**

Holons enforces this today (`packages/holosphere/reverse-sync.js:95`), and it
should stay enforced. Anyone can publish a 31923 claiming any `t` tag; the
relay will not stop them. `shifts-elinor.md` already notes that
`relay.commonshub.dev` does not enforce the coordinator-only rule its own docs
describe, and LibreSesh's `STATUS.md` records confirming this by publishing
from a freshly generated key.

So the join is: publisher surfaces its npub, operator adds it to the
community's trusted authors. One deliberate step, per community. That step is
the security boundary and there is no automatic version of it.

## Rule 5 — foreign records are read-only

**A reader MUST NOT re-publish a record whose provenance tag names another
app.**

This is the rule most easily got wrong, because nothing currently prevents
breaking it. `noteExternal()` (`packages/holosphere/projections.js:68`) only
raises a clock so the next projection is strictly newer than an external
edit — it does not suppress projection. Ingest a LibreSesh session into a
Holons lens today and the projector will publish it straight back out under
Holons' own key and a `holons:` `d` tag.

The result is two addressable events for one session, from two pubkeys,
both valid, both rendering, diverging the moment either side edits — exactly
the duplicated, contradictory schedule that addressable events exist to
prevent. Worse, each app's copy looks authoritative to its own reader.

An ingested foreign record is a **cached view**. Render it, filter it, link to
it. Edits belong to the app whose provenance tag it carries.

## Lifecycle

All three apps already behave identically here; it is recorded so a new
implementer does not have to reverse-engineer it.

| Action | Wire behaviour |
|--------|----------------|
| Create | Publish the addressable event. |
| Change | Republish the **same `d`** with a newer `created_at`. The relay keeps only the newest per `(kind, pubkey, d)`, so it replaces in place. Never a second event. |
| Delete | Publish NIP-09 kind 5 with an `a` tag for the address. |

Deletion is a **request**. Relays may ignore it; copies a client already
fetched are beyond recall; relays keep the kind 5 tombstone by design. A
reader MUST honour a kind 5 from the address's own author, and MUST ignore one
from anybody else.

## Conformance

What each app emits today, and what Rule 2 and Rule 3 require of it.

| App       | Rule 1 `d` opaque | Rule 2 `t: group-<id>` | Rule 3 provenance tag | Rule 4 trust | Rule 5 read-only |
|-----------|-------------------|------------------------|-----------------------|--------------|------------------|
| Elinor    | n/a (publishes only) | ✅ emits              | ❌ never will — external | n/a       | n/a              |
| Holons    | ❌ parses `d`      | ✅ emits               | ✅ emits, ❌ never reads | ✅ enforces | ❌ would re-project |
| LibreSesh | n/a (publishes only) | ❌ no holon concept   | ❌                     | n/a          | n/a              |

Elinor cannot be changed, so **a reader MUST fall back to its documented
`shift-…` grammar** when the provenance tag is absent. That fallback is
permanent and is the one sanctioned exception to Rule 1. It is narrow: it
applies to `d` tags beginning `shift-`, from a pubkey trusted under Rule 4,
and nothing else.

### What has to change

**LibreSesh** — emit both tags. Needs an optional holon id per event
(published programmes are already a per-event organiser decision, so the id
belongs beside that toggle, not in instance config). Sessions publish as lens
`sessions`, the 31924 calendar as lens `events`. Nothing about its `d` tags,
its addresses or anything already published changes.

**Holons** — read the provenance tag in preference to the `d` tag, keep the
`shift-…` fallback for Elinor, and refuse to re-project foreign-origin
records per Rule 5. Add LibreSesh instance keys to `trustedAuthors` per
community. Its write path already satisfies Rules 2 and 3.

## Not standardized

Deliberately out of scope, so nobody reads more into this than it says:

- **Content semantics.** A shift is not a session is not a quest. This
  contract makes records *findable and attributable* across apps; it does not
  make them interchangeable, and no app should pretend otherwise in its UI.
- **Identity.** Elinor's kind 31926 attestations map pubkeys to people for
  RSVPs. LibreSesh has no accounts by design — its speakers are names, not
  keys, which is why it puts the speaker in the content and not in a `p` tag.
  Reconciling those is a separate problem and this document does not touch it.
- **Write-back.** No app writes into another's records. Rule 5 is the whole of
  the position.
- **Relay selection, key custody and backup.** Each app's own business.
