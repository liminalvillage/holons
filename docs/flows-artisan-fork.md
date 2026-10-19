# The Artisan fork on Flows

How a graph of funds and projects — and what each was owed — is forked into
holons under one empty Pot, so that new money (or hours, or a harvest) flows
through the same pipes in proportion to their shares, and from there by what
each fund curates and each project reports. Built on what Flows already does
([`flows-harvest-collective.md`](./flows-harvest-collective.md)): a split per
holon, zones, the cascade, the signed logs, the Pot and its rights table.
This page says what the fork adds and where each rule lives.

## The shape

```
Pot (split locked at genesis: every fund and every project by what it was owed)
├─▶ Fund ── curates: zones ──▶ zone 1: project, project
│                              zone 2: project            (each zone a step down the slope)
├─▶ Project ── reports its actions ──▶ people  (legacy · needs · impact)
│        └── its own zones ──▶ partners it wants to pass value on to
└─▶ Project …
        ▲
        └─ federated to the funds that funded or curated it
```

Three kinds of holon, each independent:

- **The Pot** seats every fund and every project directly, by what it was
  owed. That split is the fork itself and is fixed at genesis. A seat that
  exits, or that nobody claimed when the claim window closed, is shared by
  everyone left, in proportion to what they hold.
- **A fund is zoned.** Curation is a fund's whole job here, and it is three
  choices on the fund's own split: how many zones there are (`nzones`), the
  slope between them (`steepness`: each zone out weighs `steepness / 100` of
  the one before, so a low number concentrates on zone 1 and a high one
  spreads further out), and which zone each project falls in (`zones`:
  project → ring). Whatever the fund does not keep for its own contributors
  (`interiorPercent`) goes down the zones. Each placed project carries its
  zone's weight and the weights are normalized over the projects placed: two
  projects in one zone get the same, and a zone nobody is in takes nothing.
  A fund can only place projects it is federated with, which is what the
  fund ↔ project links are for.
- **A project sets its own rule.** It arrives dividing what reaches it by
  what each of its people was owed (the legacy credit) and can change that:
  its actions are entries in its own signed logs (tasks and their hours,
  mints of whatever it counts), the value equation turns them into scores,
  and an `impact` bucket pays by them; a `needs` bucket is a floor for
  members in need. A project may also set zones of its own and pass part of
  what reaches it on to partners, exactly as a fund does.

A project is therefore paid along two paths: its own seat in the Pot (what it
was owed), and the zones of every fund that curates it (what the funds decide
now). The cascade adds them up; the rights table pays the sum.

Every holon has the same three rules:

- **In** — what counts as coming in and who signs it: the `flow_mints` log
  and its policy (`/fundmint`, `/fundpolicy`, MCP `flow_mint_record`,
  `protocol_policy_set`). Phase 1: a fund's admin keys are seated as admins of
  each project holon, so the fund attests a project's actions in the
  project's own log.
- **Split** — how what is inside is divided: contributors by buckets (below),
  the rest by zones. The Pot's is fixed at genesis.
- **Out** — anyone claims any time; value leaves only when the node's signers
  say so: the `flow_claims` log off-chain, the Pot's signer quorum and
  challenge window on-chain. People are paid by the Pot directly (the table
  flattens the cascade to each final holder); a fund or project that wants
  its own multisig deploys its own Pot and is paid into it.

### As imported, before anyone curates

The importer writes the fork and the simplest curation. A fund arrives with
its seat in the Pot, its federation links to the projects the catalog ties
it to, and one zone holding all of them: it keeps nothing and splits what
reaches it equally across the projects it is linked to. A fund with no link
keeps its whole share. A project arrives with one bucket, legacy 100 (what
each of its people was owed), and nobody seated, so it keeps what reaches it
until its group claims it. Changing a fund's zones today is the web or kiosk
allocation editor (the zone picker lists the fund's federated projects) or
MCP `allocation_save` (`interiorPercent`, `nzones`, `steepness`, `zones`);
there is no chat command for it yet.

The equal split is a first guess from the catalog for each fund to correct,
not the fund's own word. `--fund-zones funded=1,curated=2` grades it instead:
each linked project on a zone by the kind of its link, with `--fund-slope`
(default 50) and `--fund-keep` percent held back (default 0). `--fund-zones
none` writes no zones, and nothing flows from a fund until it curates. When
a group claims a project, every fund linked to it aliases the project to the
chat, so a fund's zone keeps paying whoever holds the seat.

## Buckets: one interior, several rules

`settings.allocation.buckets` divides the contributors' share by a list of
rules, each with the slice it governs (read against their sum):

| mode       | divides its slice                               | used for         |
| ---------- | ----------------------------------------------- | ---------------- |
| `custom`   | by hand-set weights (`shares`)                  | legacy credit    |
| `needs`    | equally among members who signed a `needs` flag | the needs floor  |
| `equation` | by the value equation's scores                  | validated impact |
| `equal`    | equally among the roster                        | a plain floor    |

`composeInterior` (`buckets.ts`) folds them into the one roster `allocate`
already takes, so the cascade, the ceilings, the rights table and the
diagrams are untouched; `byBucket` rides beside for editors. A bucket nobody
is in pays nobody and its slice goes to the others — a project that adds an
impact bucket before anyone has scored is carried by its legacy credit until
someone does. A holon without `buckets` divides its interior the single way
it always did. An imported project starts with the legacy bucket alone; the
others are its to add (`/split`, `--project-split legacy=40,needs=30,impact=30`).

## Standing: exit and needs

Two append-only logs (kind 1808, `protocol.collapse`), because the two need
different quorums:

- **`flow_exits`** — `exit { party, epoch }`, the party's own word (quorum 0;
  an attester may dispute). From the next new-moon cut the party is in no
  bucket of that node and the remaining holders' shares grow, each by the
  same factor: the retired share is spread over everyone left in that node
  in proportion to what they hold. A project seated straight in the Pot that
  exits is therefore shared by the whole Pot. The rows the Pot already
  committed stay collectable (a table never decreases). Said once.
- **`flow_needs`** — `needs { party, on }`, attested like a claim (quorum 1;
  an attester's own flag self-attests); the latest accepted word per party
  wins.

Hold, and your share is a claim on everything that comes in later. Exit, and
you collect what the table owes you and your share is burned: it is nobody's,
so everyone left holds more of the pool.

### The claim window

`allocation.claimWindow = { until, keep }` on a holon that seats projects
says until when those seats may be claimed. The importer sets it six months
out (`--claim-months`, `--claim-until`) on the Pot, with the funds in `keep`:
a fund stands without a claim. Once `until` has passed, a hand-set seat that
no alias points at a claimant is read exactly as an exit (`lapsedSeats`): in
no bucket of that node from the next cut, its share spread over everyone
left, the rows already committed still collectable. `/claimproject` refuses
a code whose seat's window has closed. The lapse is to the seat in that
node, not to a fund's zones: whether a fund keeps placing an unclaimed
project is the fund's curation. The window is held by the genesis lock, so
moving it takes `force`, and is read against the cutter's clock: a cut made
across the closing instant can differ between two signers, which the
challenge window settles.

## Aliases and claim codes

The importer seats people it cannot name by key as placeholders
(`artisan:<id>`) and projects as key-founded holons (`holon_…`). A node's
`allocation.aliases` maps a placeholder onto whoever claimed it — one hop,
applied wherever the placeholder is read (split, cascade, ceilings, the cut,
"Reaching you"). `allocation.codes` holds `sha256(code) → what it claims`;
the plain code lives only in the importer's output file and is consumed by
removing its hash. Aliases and codes are the rule at work, never the rule:
they never trip a genesis lock.

- A project's Telegram group claims it by adding the bot: the project's link
  (`t.me/<bot>?startgroup=artisan_<project holon>_<code>`) opens Telegram's
  group picker, and the bot claims the seat as it joins. Nobody is added to
  anything; `/claimproject <project holon>_<code>` is the same by hand. The
  code is kept on the
  project's own holon as a seat claim (`seatClaim(parent)`: "this code
  claims my seat in `parent`"), so a Pot that seats two thousand projects
  does not have to carry two thousand codes. The project's buckets and
  credit codes move onto the chat; the holon that seats the project — its
  fund, or the Pot — aliases the project holon to the chat; the chat is
  federated with it and with every fund the project was linked to. Scoring,
  `/fund*`, needs and exits then run under the chat id as they do for any
  group. (A code kept on a fund and naming the project still works.)
- A person claims their seat in the chat: `/claimcredit <code>`; the chat
  aliases the placeholder to their Telegram id. `/wallet <0x…>` writes the
  payout address on their own record (`settings.payout`).

## Fixed at genesis

`allocation.genesis = { hash, at }` pins the rule: `splitHash` over the
buckets, their weights and the contributors' percent (aliases, codes, rings
excluded). `saveAllocationConfig` refuses a change to a locked rule without
`force`; `cutRights` reports `the split differs from genesis` and refuses to
publish when the root's rule no longer matches, so a drifted Pot split
publishes nothing and the income rolls into the next moon. Settings are
last-writer-wins and cannot honestly be hardened further; the lock is
enforced where money moves.

## The Pot's owner

`Pot.sol`'s `veto()` and `setSigners()` are `onlyOwner`: the owner alone can
withdraw a pending root and replace the signers. "No single key" therefore
means deploying with the genesis Safe as owner — the Owner field on the Pot
panel (kiosk, web), recorded as `settings.pot.owner`. `settings.pot.walk`
sets how far the cut walks (`holons`, `depth`, `nodes`) for a cascade wider
than the defaults. The walk reads every party once, people included, so set
`holons` to at least funds + projects + people.

## The importer

```
node --env-file=.env scripts/import-artisan-graph.mjs \
  --export artisan.json --map mapping.json --out artisan-map.json \
  [--admins npub…,npub…] [--bot <hex pubkey>] [--bot-username HolonsBot] \
  [--pot-split legacy=100] [--fund-split legacy=100] \
  [--project-split legacy=100] [--fund-zones funded=1,curated=1] \
  [--claim-months 6] [--write]
```

Dry run by default. It reads the export through a mapping file onto the
declared schema (`funds`, `projects`, `people`, each with `owed`), mints
deterministic holon ids (`sha256(namespace, kind, source id)` — a re-run
tops up, never forks), founds every holon with the importer key (seating
`--admins` and `--bot` as admins), links fund ↔ project, and saves each
node's buckets with the legacy weights set to what each was owed: the Pot
over its funds (locked), a fund over its projects (with the project claim
codes), a project over its people (with the credit codes). A person with a
Telegram id or npub in the export is seated under it directly; one with a
wallet is paid there from the first table. The output file holds the plain
codes and deep links — keep it private (it is gitignored).

### From the artizen.fyi leaderboard

The public leaderboard export is not a ledger: it has what each project
raised per season and what each fund still held, no project → fund link, no
people and no wallets. `scripts/artizen-fyi-to-graph.mjs` turns it into the
declared schema and states what it assumed:

```
node scripts/artizen-fyi-to-graph.mjs --in artizen-fyi.json --out graph.json \
  --project-owed raised-sales --fund-owed available
```

`--project-owed` is a column or columns added and subtracted: `raised-sales`
is what a project raised less the community sales, which were paid out — the
match, prizes, bonus and Venus money are what is owed. A fund is owed what
it had `available`. The leaderboard ties no project to a fund, so a project
names none and the importer seats it straight in the Pot: every project is a
holon of its own beside the funds, and the Pot's one settings document
carries all the weights (about 56 KB for 1,900 seats; the relay took it).
Try a write under another `HOLONS_APP` first; ids are per namespace, so a
trial costs nothing.

Which fund stood behind which project is in the same site's matching
catalog (`artizen.fyi/match/index.json`), as `funded`, `curated` and
`submitted` pairs. `--catalog <file> [--link-kinds funded,curated]` turns
those pairs into `links`, and the importer federates each one, fund ↔
project. A link is a relationship, not a seat: the catalog has no amounts,
so no share moves: the project's seat stays in the Pot. A fund that is
linked but owed nothing is founded without a seat in the Pot. The exact
per-fund amounts were served by Artizen's own data API, which is no longer
public.

## The map

A split is stored on whoever pays, so "who gets what, through whom" has no
document of its own: it is the cascade, walked. A cut walks it once a
lunation to make the table. The **flow graph** is the same walk kept as a
map — every party once, every "A pays B" once, with the share of the Pot
that travels it — so it can be drawn and looked up from either end.

`buildFlowGraph` folds the tree `resolveCascade` returns and adds nothing of
its own: a party's `share` is the sum of the paths that reach it (a project's
own seat plus every fund that curates it), a link's `share` the sum of the
tree edges it stands for. The map therefore says exactly what the cut pays.
Funds the Pot is federated with but does not seat are on it too, by their own
split and at no share.

Nothing on a holon says "fund" or "project". `classifyParty` reads it off the
shape: the root is the Pot; an `artisan:<id>` seat is unclaimed; a Telegram
id, or a key that passes nothing on, is a person; a seat the Pot's claim
window keeps without a claim is a fund, and so is a holon that only curates
(partners on its rings, no contributors of its own); the rest are projects.
If that ever misreads a holon, the importer should say the kind outright.

**Published as a snapshot.** A Pot with two thousand seats is a quarter of a
megabyte and a relay drops an event past 64 KB without a word, so the graph
is stored on the Pot holon's `flow_graph` lens as a head and numbered parts
(`encodeFlowGraph`, 40 KB each), replaced in place. Each part names its
generation and the head names the one that is whole: a reader that arrives
mid-publish gets nothing rather than a mix, and keeps the map it had.

```
node --env-file=.env scripts/publish-flow-graph.mjs --pot <pot holon> [--write]
```

Dry run by default: it prints the parties by kind, the largest funds and
projects, whether the walk was whole, and the part sizes. With `--write` it
publishes and reads the lens back to confirm the generation landed. Publish
after the split changes — a claim, an exit, a fund's curation — and after
each cut; the bot does not do it yet.

**Read by Flows** (`apps/flows`), the explorer: a person's own page (what
reaches them, where they are paid, what they can collect), any fund or
project rooted the same way, and the ecosystem on three columns. It loads
the snapshot in one read, then reads the split of the holon on screen
afresh (`refineFlowGraph`) and says when the snapshot had drifted. Looking a
party up by wallet works because the graph carries each party's payout
address, which is already public on its settings document and in the table.

## The account

Flows opens every party — a person, a project, a fund, the Pot — as an
account: its name, what is in it, and what its reader may do.

**The balance** is one figure per unit, never a total across units
(`account.ts` `accountBalances`). Money sits in two kinds of place and a unit
is only ever in one of them per holon: a seat in a Pot, collected on chain
(`potAccount`), and a right in a fund's own money — its mints, its linked
collective — drawn through that fund's `flow_claims` log. A statement reads
each fund above the party for what it holds ITSELF (`loadClaimCeilings` with
`ownOnly`): what reaches a project from the fund above is the same money, and
is counted once, where it is held. The shares come off the map
(`graphRights`), so a Pot of thousands is not walked again.

**Claiming** has four ways out (`claimRails`): the wallet, and three that
leave through the fund's OpenCollective — an expense, PayPal, a bank
transfer. On chain there is only the wallet, and the party sends the Pot's
claim itself. Anything else is a request: a claim on the fund's log carrying
its `rail`, which the fund's attesters approve and, once the money has gone,
mark paid with the `rail` and a `ref` to where the payment can be seen. No
bank detail or PayPal address is ever written here: the payee enters them on
OpenCollective, which pays. Flows records the claim and opens the
collective's expense form with a reference to paste; it cannot file the
expense itself.

A founded fund counts only its members' entries, so a request is offered
only where this session's key is one the fund hears (`writeAcceptance`).
A person seated under a bare key speaks for the party that key names
(`selfKeyedPartyOf`) — and for nobody else; whether the key is accepted is
still the membership's call.

**Funding** an account is its Pot's address, when it has one, and its
collective's contribute page, when one is linked. A steward links the
collective (`saveCollectiveSlug`); the slug is checked against OpenCollective
before it is stored.

**Applying.** A party asks a fund for a seat with an `apply` on the fund's
`flow_applications` log (`applications.ts`). Anyone may ask — an applicant is
not a member yet, so this log does not run the author rule — and asking
moves nothing. Only the fund's admins answer: approving
(`approveApplication`) federates a holon applicant, places the party on the
fund's outermost ring unless it already sits on one, and attests; declining
records a reason. Each entry says whether its signer was seen to speak for
the party. A fund closes itself to applications with
`allocation.applications: 'closed'`.

**Redistributing.** A holon's stewards edit its way out at `/h/<holon>/split`:
what stays, the rings, who sits on which (`split-draft.ts`). It covers what a
genesis lock leaves open — rings, slope, placements — and the keep where the
split is not locked; the contributors' rule (shares, buckets) is not there.
A holon placed on a ring without a federation link is flagged, because every
reader drops it. Only an admin's settings write is read back, so the editor
asks first (`isHolonAdmin`) and is read-only for everyone else.

## Where each rule lives

| rule                             | where                                                                                                                                                                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| buckets, aliases, the split hash | `@holons/core/flows` `buckets.ts` (`composeInterior`, `applyStanding`, `splitHash`), `settings.ts` (`readAllocationBuckets`, `…Aliases`, `…Codes`, `…Genesis`, `saveAllocationAliases`, `saveAllocationCodes`)                                                            |
| the claim window                 | `buckets.ts` (`lapsedSeats`), `settings.ts` (`readAllocationClaimWindow`, `claimWindow` on `saveAllocationConfig`); applied in `cascade-load.ts`, `inbound.ts`; reported by `cutRights` (`lapsed`) |
| standing applied to a split      | `cascade-load.ts` (`standingOf`), `inbound.ts`, `rights-cut.ts` (`exited`, the genesis check)                                                                                                                                                                             |
| exits, needs flags               | `standing.ts` (logs `flow_exits`, `flow_needs`; `buildExit`, `buildNeeds`, `foldExits`, `foldNeeds`), `standing-load.ts`; defaults in `protocol/policy.ts`                                                                                                                |
| the Pot's owner and walk bounds  | `pot-record.ts` (`owner`, `walk`, `savePotWalk`); deploy in `apps/web/src/lib/holons/pot.ts`, `apps/kiosk/src/lib/pot.ts`                                                                                                                                                 |
| MCP                              | `allocation_save` (buckets, aliases, codes, genesis, force), `allocation_get` / `allocation_cascade` (byBucket, standing), `allocation_alias_set`, `standing_state`, `standing_exit_record`, `standing_needs_record`, `standing_verdict`, `pot_rights_cut` (exited, lapsed, walk); `allocation_save` / `allocation_get` (claimWindow, lapsed) |
| bot                              | `packages/telegram-ui/src/ArtisanFork.js`: `/claimproject`, `/claimcredit`, `/wallet`, `/split`, `/needs`, `/needsattest`, `/needsdispute`, `/exit`, `/pot`; the new-moon cut in `FundClaims.js` reads standing and the walk bounds; with `FLOWS_ADDRESS` set, `/pot`, `/split`, `/wallet`, the two claims and the new-moon notice end with a link into Flows (`flowsLink.js`)                                       |
| the importer                     | `scripts/import-artisan-graph.mjs`                                                                                                                                                                                                                                        |
| the account, claims by rail, applications, the split editor | `@holons/core/flows` `account.ts` (`accountBalances`, `claimRails`), `claims.ts` (`ClaimRail`, `rail` / `ref`, `selfKeyedPartyOf`), `claims-load.ts` (`loadJudgedClaims`, `partyStandings`), `ceiling-load.ts` (`shares`, `ownOnly`), `flow-graph-views.ts` (`graphRights`), `opencollective.ts` (`collectiveDonateUrl`, `collectiveExpenseUrl`), `applications.ts` / `applications-load.ts` (lens `flow_applications`), `split-draft.ts`, `settings.ts` (`readApplicationsOpen`); `@holons/core/holosphere` `isHolonAdmin`; MCP `fund_apply`, `fund_applications`, `fund_application_verdict`, `rail` / `ref` on `flow_claim_record` / `flow_payout_record`; drawn by `apps/flows` |
| the flow graph (the map)         | `@holons/core/flows` `flow-graph.ts` (`buildFlowGraph`, `classifyParty`), `flow-graph-doc.ts` (lens `flow_graph`, parts), `flow-graph-load.ts` (`crawlFlowGraph`, `publishFlowGraph`, `loadFlowGraph`), `flow-graph-index.ts` (`seatersOf`, `partiesByAddress`, `resolveParty`), `flow-graph-views.ts` (`centredTrack`, `ecosystemTrack`, `refineFlowGraph`), `flow-graph-space.ts` (`layoutFlowSpace` — every party placed in 3D, a link's width linear in its share of the Pot), `pot-account.ts`; `scripts/publish-flow-graph.mjs`; MCP `flow_graph_publish`, `flow_graph_get`; drawn by `apps/flows` |

## Not yet

- The map is published by hand (the script, or MCP `flow_graph_publish`). The
  bot cutting it at each new moon, from the cascade the cut already resolved,
  is the next step; until then the explorer shows how old its map is.
- Flows cannot file the OpenCollective expense: it records the claim and
  sends the payee to the collective's form. Matching a paid expense back to
  its claim is an attester's hand, not a webhook. PayPal and bank transfers
  exist only for a fund with a linked collective in that currency.
- Someone with a right in a fund they are not a member of cannot request it
  from Flows: a founded fund hears only its members. Its stewards record it
  (the bot, on the member's word), or seat the person as a member.
- A key sign-in is held in memory: after a reload Flows says so and stops
  offering to act until the person signs in again.
- The split editor does not edit buckets or the contributors' shares, and
  cannot federate a new project by itself — approving an application does.
- Collecting and setting a payout wallet from a browser wallet still needs
  the page opened inside the wallet app; there is no WalletConnect.
- Curation has no chat command: a fund sets its zones in the web or kiosk
  editor or through MCP.
- A project returning value to the funds that backed it is not a mechanism
  of its own. A project can place a federated fund on its zones today; what
  that should mean, like lending out idle funds or what a run on the Pot
  does, waits for the economics to be worked through.
- A cut made moments after a large write can read a fund's old split and
  still call itself complete: a document that has not arrived looks like the
  one before it. Two signers then disagree on the root, which is what the
  challenge window is for; cut again before signing a first table.
- The web and kiosk allocation editors show and edit the single-mode split
  only; buckets, the lock and the exit / in-need buttons are MCP and bot
  for now.
- A fund countersigns a project's actions by being seated as its admin; a
  `partner:<holon>` attester role is the cleaner form (policy, federation).
- The contract itself still trusts one owner; a veto by signer quorum is a
  change in the contracts repo.

## Resources: eight forms of capital, and the bandwidth rule

Money is one stream among eight. A **gift** (`resources.ts`) is a `give` on
the RECIPIENT's `flow_resources` log (kind 1808): who gave it (`from`), one of
the eight capitals (`CAPITALS` — the CapitalGame's types, financial last), an
amount and unit, what it was, an optional evidence link (`proof`) and the offer
it answers. Anyone may give — like an application, this log does not run the
author rule — and a gift counts once an **admin of the recipient** attests it
(an admin's own `give` counts as written); a dispute carries a public reason.

A holon's **resource base** is its received gifts that are not money, counted
(units do not mix; a count is checkable by anyone reading the log). Offers
(`resource-offers.ts`) live on the holon's settings under `resourceOffers`,
each with its terms of access — `when`, `who`, `how` — visible to everyone.

**The public rule — resource base → financial bandwidth.** A split with
`allocation.resourced` (0–100) sends that percent of its exterior by each
placed partner's resource base instead of by its rings; the rest follows the
rings, and with nobody resourced the rings carry it all. Every walk that pays
or draws (the cut, the crawl, the boards, the bot, MCP) injects `resourcesOf`
so the table and the map agree. The flow graph carries each node's counts per
capital (node row index 9), which is what the map's halos, the leaderboard
(`rankByResources`) and `traceAmount` read.

MCP: `resource_give`, `resources_get`, `resource_verdict`,
`resource_offer_save`, `resource_ranking`, `flow_trace`; `allocation_save`
takes `resourced`.

