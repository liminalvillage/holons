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
