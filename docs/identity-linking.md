# Identity, founding and linking

How a person signs in, how a holon is founded from a screen, how keys become
members, and how a Telegram chat is tied to such a holon. The rules live in
`@holons/core/holons`, `@holons/core/linking` and `@holons/core/protocol`
(founding); every surface — kiosk, web, bot, MCP — calls the same functions.

## Who is who

| Thing | Identity | Who speaks for it |
| --- | --- | --- |
| A person | a Nostr key; their holon id is the pubkey hex | the key itself, plus keys it linked in its own signed `users` record |
| A holon founded from a screen | `holon_…` (the first ones were minted as `hub_…`, still recognised) | the signed `_members` log: the founder's key is genesis, admins seat and unseat keys |
| A Telegram chat | the chat id | the bot key that founded it |

Sign-in ends in a Nostr key on every surface: the person's own key (pasted or
created), a passkey (web), an Ethereum wallet, or Telegram (a server-derived
key). The kiosk offers **stay signed in on this device**: the key at rest is a
NIP-49 `ncryptsec` behind a PIN (`@holons/core/auth` `sealSecretKey` /
`openSecretKey`), opt-in, forgotten on logout. A person's holons are kept in
their own holon's `holons` lens (`rememberHolon` / `myHolons`), so the same
list appears on every device they sign in on.

## Founding and members (NIP-29 shaped)

`createHolon` mints an id and signs the genesis of its `_members` log; the
founder is the first admin. Membership is by key:

- a person asks with a kind-9021 join request carrying their display name
  (`requestToJoin`); admins see them live (`watchJoinRequests`) and seat the
  key (`approveJoin` = a signed `_members` add + a kind-9000 put-user + the
  refreshed group state), or unseat it (`removeSeat` = remove + kind-9001);
- a member says goodbye with kind-9022 (`leaveHolon`); an admin removes the seat.

The same ask works on a hub born in Telegram: its bot founds the `_members`
log (genesis = the bot key) and seats every member's derived key, the keys
they linked with `/key`, and the chat admin's keys — derived and linked — as
admins. A person on their own key therefore needs no Telegram at all: they
ask from Settings (kiosk or web, shown there whenever the signed-in key is
not seated; the request is signed by the key, which is the whole proof), and
an admin on a screen seats them. The bot's roster sync prunes only the seats
it granted itself (`syncMembersLog` → `seatAuthors`), so a seat another
admin granted survives its next refresh. Without a seat a key's writes reach
the relays but no enforced reader shows them (`writeAcceptance` = `held`).

The Telegram group hears the ask too (`packages/telegram-ui/src/JoinRequests.js`;
one relay filter for every chat, `watchAllJoinRequests`):

- **A Telegram login that is in the group is linked at once.** The request
  carries the person's Telegram id as an `i` tag (`telegram:<id>`). That is
  only a claim, and `describeApplicant` proves it: the key a Telegram login
  derives from that id is the key that signed the request. Telegram says
  whether the user is in the chat; if so the bot writes their `users` record
  and seats the key. No admin step.
- **Anyone else is announced in the group**, once: a person on their own
  Nostr key (named by the request, else their kind 0, else the short npub),
  or a proven Telegram user who is not in the group (named with their
  `@username`). The post has Link / Decline buttons that only the chat's
  admins can press; Link runs `approveJoin` with the bot key.

What was announced and decided is the holon's `joinrequests` lens (one record
per asking key: `pending`, `approved`, `declined`). It stops a restart or a
replayed event from posting twice, and `approvedJoinKeys` is what the bot's
roster sync adds to its desired set, so a key the bot seated on an admin's
word is not pruned. A record counts only when an admin of the holon signed it
(the `members` capability) — a member writing `approved` seats nobody — and
`removeSeat` withdraws the approval, so an unseated key stays unseated.
`JOIN_NOTICES=off` silences the service on one of two bots sharing a
namespace.

On screen the whole story is told with one word, **link**: a Telegram chat
is linked to the hub (a hub born in a chat stays linked to it by default), a
person's key is linked to the hub directly or through that chat, admins link
and unlink keys, a person asks to be linked. "Seat", "roster", "founded" and
"accepted" are model words for the code and these docs, never for the UI
(Settings → Members on kiosk and web).

The relay (strfry) does not implement NIP-29, so the holon's **admins play the
relay's role**: they sign the 39000 metadata, 39001 admins and 39002 members
events from the log (`publishGroupState`, published only when the content
changed). A real NIP-29 relay can take over unchanged.

Membership is as-of-time: a record signed before its author was seated never
counts. A join request therefore carries the name, and the person's `users`
profile is written only once they are seated (`ensureProfile`, called by the
surfaces on bind). Every `_members` op is stamped strictly after the log's
latest second (`nextMembersAt`) so an op in the same second as the seat that
authorises it cannot sort first.

## Linking a key you hold to your Telegram account

A Telegram member always has the key the bot derives for them. A key they
hold themselves — the kiosk's device key, a Nostr client's — counts as the
same person once it is linked on their personal holon's `users` record
(`linkedKeys`, attested by kind 31926); the bot's roster sync then seats it
in every chat they are in. Linking needs proof of control, and the proof is
a note signed by the key being linked. Two ways in, both in
`@holons/core/users`:

- **From Telegram** (`/key link npub1…` in a private chat): the bot issues a
  code, the person posts it in a note from that key with any Nostr client,
  and taps Verify (`buildKeyLinkChallenge`, `verifyKeyLinkProof`).
- **From the screen that holds the key** (kiosk Settings › Members › *Link
  via Telegram*): the screen mints the code, signs the proof note with the
  key and publishes it (`buildKeyLinkOffer`, `keyLinkProofTemplate`, tagged
  `holons-key-link` and with the code), then opens
  `t.me/<bot>?start=keylink_<code>_<16 hex of the key>`. The bot finds the
  note by its code tag, checks the author matches the prefix and the note is
  fresh (`keyLinkProofPubkey`), and links that key to whoever tapped. A code
  is honoured once; the bot never signs anything — the proof is the screen's.

## Linking a Telegram chat

Two holons take part: **D**, founded from a screen (its admins are keys in its
log), and **T**, a Telegram chat (its anchor is the bot key **B**). Neither
can write into the other, so the link is a pair of signed records in each
holon's `links` lens, keyed by the same id, each counting only when its own
authority signed it. Afterwards the two seat each other's admin key.

```
kiosk/web (admin P of D)              Telegram (bot B, chat T, admin U)
──────────────────────────            ──────────────────────────────────
1 OFFER   D/links/H = offered, by P
          H = sha256(τ)[:32]
          deep link  link_<D>_<τ>  ─────▶  2 ACCEPT  U taps /start link_…
                                            U must be creator/admin of T
                                            read D/links/H: signed by an
                                              ADMIN of D at that time?
                                            found T if new; seat P as admin
                                            T/links/H = accepted, peer D  (by B)
                                            hubclaims/claims/H → T (so the
3 COMPLETE watch the claim  ◀───────────     screen learns which chat)
          read T/links/H: signed by T's
            anchor, names D?
          human confirms the chat title
          D/links/H = linked, peer T
          seat B as admin of D
          federate D ⇄ T on every lens
4 UNLINK  either side alone: its record → unlinked, the other's key unseated
```

Consequences of a link:

- D's admins edit T from the dashboard (P counts in T);
- the bot brings T's members into D (`bridgeTelegramRoster`, adding only, and
  only while B is seated as admin of D — never founding a screen's holon);
- the bot's roster sync keeps P seated in T (`linkedAdmins`) through prunes;
- every board lens federates both ways (`federateLinkedChat`).

Threat model:

- only an **admin-at-time** of D can author an offer that counts — the bot
  reads the envelopes and checks the role at the envelope's time, never the
  plain last-writer-wins read;
- only **T's anchor** (B) can author an acceptance the screen believes — the
  claim record merely points at a chat; the chat's own signed record decides;
- `H` reveals nothing about τ; τ travels only in the deep link, is single-use
  (the claim record marks the first tap) and expires after six hours;
- the person tapping must **admin the chat** (Telegram's own membership);
- a human confirms the chat's title before B is seated in D — a rogue bot key
  never becomes an admin of D on its own;
- unlinking is unilateral and as-of-time: nothing already written is lost.

## Names

An id is never what a person sees. Every surface names ids through ONE
resolver, `createNameResolver` in `@holons/core/identity`, and every surface
falls back to the same short form (`shortId`: `npub1abcdefgh…xyz123` for a
key, `#235114395` for a Telegram id, a holon id as itself) — never a bare hex
key, never "Unknown".

The resolver asks, in order:

1. the signed-in person (their own id);
2. the `users` record in the holon on screen, then the person's personal-holon
   record (`users/<id>` under `<id>`);
3. for a key, the kind-31926 directory: the Telegram person behind the key →
   their record, else the attested name;
4. for a key, their kind 0 on the relays (one bounded query per hundred keys,
   through holosphere's `queryNostr`, nothing left open);
5. for a key, the join request they sent (the surface watches those);
6. for a holon — and for a key no person source named — `settings.name` (or
   `title`; the web's old "My Holon" default is not a name), then HNS, then
   whatever the surface already holds (`prime`: federation partner names, the
   linked chat's title).

A 64-hex id is tried as a PERSON first: a key user's personal holon is that
person. Names are cached (10 min), misses briefly (60 s); a resolver tells its
subscribers when a name arrives, so the short form on screen is replaced in
place.

Where it lives per surface: kiosk `$lib/names` (`$nameOf(id)` in templates),
web `$lib/stores/nameResolver` (`resolvedName(id, $nameMap)`), bot
`protocolContext.partyNames` / `utilities.getHolonName`, MCP `names` maps
beside the ids in `holon_members`, `holon_join_requests`, `flow_claims_state`,
`flow_mints_state`, `protocol_log`, `governance_votes_state`,
`privacy_audience`.

### Profiles align on kind 0

- A key user's name is READ: their kind 0 (set on any Nostr client) names them
  everywhere, and seeds the kiosk/web session name and picture at login. No
  stand-in (`npub1…`, a hex prefix) is ever written as a name: `ensureProfile`
  and `approveJoin` refuse placeholders; the web stores an initiator as
  `{ id }` only.
- A key user's profile is WRITTEN from Holons only when they edit it
  (`publishProfile`): the existing kind 0 is fetched and the edit laid over it,
  so a `nip05`, `lud16` or banner set elsewhere survives. Telegram-derived keys
  keep the bot's projection (they have no life outside Holons).
- A member's kind-0 edit folds back into their `users` record on every host:
  kiosk, web and MCP trust a holon's seated keys (`membersTrustedAuthors`),
  and reverse-sync reaches a hub record keyed by the pubkey when the Telegram
  id has none there.
- An admin seating a join request writes the joiner's record with the name on
  the request (once, never over the joiner's own write), so the roster names
  them from the first moment.
- A digits-only handle (the bot's default username) is not a name: it never
  becomes a kind 0 `name`, and `userName` skips it.

## Where each surface plugs in

| Surface | Sign-in | Found / members | Telegram link |
| --- | --- | --- | --- |
| kiosk | `LoginCard` (key first, PIN remember), `rememberKey.ts` | dock "+" → New hub, Settings › Members, menu Join / Leave (`hubmembers.ts`) | Settings › Telegram (`tglink.ts`, `LinkTelegramSheet`) |
| web | `LoginCard` (key first) | sidebar "Start a new hub", Settings › Hub key | Settings › Telegram |
| bot | — | roster sync (`createTrustCache`) | `/start link_…`, `/unlink` |
| MCP | `HOLOSPHERE_NSEC` | `holon_create`, `holon_members`, `holon_join_*`, `holon_member_*`, `holon_list_mine` | `holon_telegram_link_*`, `holon_telegram_links`, `holon_telegram_unlink` |

## Not in this round

- **NIP-07 extension sign-in**: holosphere consumes the raw secret
  synchronously (constructor, `login`, `signing.js`, the NIP-44 privacy layer,
  `nostr-dm.js`) and so do core's NIP-98 helper and the kiosk's log signers;
  an async `NostrSigner` seam (`signEvent`, `nip44.encrypt/decrypt`) across all
  of them is two to three days of holosphere work.
- **The Telegram chat writing into the holon's id**: the bot resolves the chat
  id in hundreds of places; a `chat → holon` indirection is its own branch.
- The global federation record is still unauthenticated (pre-existing).
