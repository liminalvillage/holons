# A harvest collective on Flows

How several holons share one harvest — the olive oil case — using nothing but
what Flows already does: an allocation split per holon, the cascade that
follows a share into the receiving holon's own split, a signed **mints** log
that says what the fund holds, and the signed **claims** log that members
draw it down with. Every surface (kiosk, web, Telegram bot, MCP) reads the
same lenses and folds them the same way; this page says which knob lives
where.

The worked example is the Olive Collective at Liminal Village. Change the
names and the weights and it is a firewood pool, a shared harvest of
anything, or a grant divided across a federation.

## The shape

```
Liminal grove                              Casa Selva grove
│  fund  = the oil from these trees,       │  (the same, for its own trees)
│          minted in L per pressed lot     │
│  split = Contributors 100 %, custom:     │
│          Liminal 50 · Collectors 50      │  Casa Selva 50 · Collectors 50
│                                          │
├─▶ Liminal  ─ its own split ─▶ members and rings          (cascade)
│                                          ├─▶ Casa Selva ─ its own split ─▶ members
└─▶ Collectors (the pickers — a Telegram group with the bot)  ◀──────────┘
       fund   = what reaches it from every grove (its halves, added up)
       split  = Contributors ~80 %, by the value equation
                 (hours weigh most; euros paid for the press weigh too)
                Reciprocity zones ~20 %, people on rings: the cook, the tool lenders
```

The two locations are independent: nobody sits above them. Each has a
**grove** — the holon that owns its trees and mints its oil. The oil from
Liminal's trees is Liminal's; the grove's split is the deal with the pickers,
half to the house and half to whoever picked. The Collectors divide what
reaches them from every grove by contribution and relationality, and never
need to know which grove a litre came from. Half of a 300 L season at Liminal
and half of a 100 L season at Casa Selva come to 200 L for the pickers,
150 L for Liminal and 50 L for Casa Selva — nobody set those numbers; they
fell out of which trees the olives were picked from.

A grove is a holon of its own, and not the location itself, for one reason:
a split is per holon, not per unit. Liminal's split is tuned for its euros
(equation, rings that reach Casa Selva and Lunation); seating the pickers in
it at 50 % would hand them half of Liminal's euros too.

Three ideas carry the whole thing:

- **A seat is a holon.** In a custom split, a contributor row can be another
  holon, not only a person. A grove seats its location and the Collectors
  with weights; what each receives is then divided again by that holon's own
  split — the cascade. A holon that never configured a split keeps what it
  gets.
- **The pot is whatever was minted.** A fund used to be OpenCollective money
  only. Now an attester appends a `mint` (amount, unit, memo) and that is
  what the split divides, in that unit. Litres stay litres: nothing converts,
  and a holon holding euros and oil has two pots.
- **Access is burned or given, never converted.** A mint opens access; the
  cascade says how much of it each party has; a `claim` burns some of it and
  a `transfer` (a _give_) burns yours and opens the same amount for someone
  else. Every person and holon on the cascade sees their litres as access in
  their Fund account. They claim it in the holon where they are a member; an
  attester attests and records the `payout` when the oil is handed over. A
  give is judged the same way and never taken back; whoever received it —
  seated on the split or not — claims it or passes it on. Same log, same
  rules, same fold as money.

## Setting it up

### 1. The holons

One grove per location, plus the **Collector's guild** (`-5468909450`,
a Telegram group with @HolonsBot). A grove can be either kind of holon:
a Telegram group with the bot (id = chat id; the group's admins are its
attesters, and `/fundmint` works in the chat) or a key-founded holon
(kiosk "+" → new, or MCP `holon_create`; the founding key is the first
admin and attester, no chat needed). Both work on every surface. Liminal
(`-1003864542239`) and Casa Selva (`-1002964866719`) already exist and
change nothing.

The earlier shape — one "mother" (Oilonics, `-5560750486`) minting the
whole season and splitting it 25/25/50 by hand — is retired: the fixed
weights could not follow the yield per location, and the promise belongs to
the people who own the trees, not to a holon above them.

### 2. Federation

Each grove links its location and the Collectors: on the web
`/<grove>/federation`, in the kiosk Federation lens, or via MCP
`federation_link_add`. No lenses need to flow either way for the split to
work; the link is what lets a partner be seated and what lets the child find
its upstream. The location and the Collectors each see the grove as a
partner automatically (the link is mirrored).

### 3. The groves' splits

Kiosk: Flows → gear → **Contributors** → _Custom split_ → add the location
and the Collectors from the picker (they appear as "Liminal (holon)" etc.)
and type the weights. **Split**: Contributors share 100 % (the zones are
unused here). Web: the Fund allocation panel's editor does the same. MCP:

```
allocation_save { holon: <liminal grove>, interiorPercent: 100, interiorMode: "custom",
                  shares: { "-1003864542239": 50, "-5468909450": 50 } }
```

Or run the seed script once the groups exist — it links the partners, saves
every grove's split and the Collectors' equation and split in one go:

```
node --env-file=.env scripts/seed-harvest-collective.mjs \
  --grove <liminal grove>=-1003864542239 \
  --grove <casa selva grove>=-1002964866719 \
  --collectors -5468909450
```

Weights are read against their own sum: 50/50 and 1/1 are the same split. A
grove that strikes a different deal (a third to the pickers, say) sets its
own weights; what was already claimed stays as it was (a claim freezes its
share).

**Rules** (kiosk Rules tab, web Rules, `/fundpolicy`): in each grove, pin
the location and the Collectors so their claims fold into the grove's
statement (`/fundpolicy pin <holon id>`, once each). The claims log and
the mints log each take their own policy; admins attest both by default.

### 4. The Collectors' split

Value equation (kiosk Flows gear → equation, web Status, `/equation`):
`hour` high (say 10), `euro` 1 (whoever fronts the press bill scores the
balance owed to them), everything else 0. A fresh holon is egalitarian —
every weight 0 divides equally — so set this before the first harvest day.

Split: Contributors ~80 % by equation. Zones: place the **cook** and the
**tool lenders** as people on rings (Zones tab → People). Ring 1 weighs most;
`steepness` sets how fast the rings fall off.

Hours are what the split reads. Every harvest day is a quest the pickers
join; each one logs their time on it — bot `⏰ +15m` / `⏰ +1h` buttons under
the task, or the hours field in the web task modal. (The kiosk has no hours
logging yet.) The press bill is an expense: `/expense` or the web Expenses
board, paid by whoever paid, split with the group. Thanks to the cook can
also be an appreciation on the cooking task if you prefer weights to rings.

Contribution is pooled per lunar cycle across every grove: a picker who only
picked at Casa Selva shares in the oil from Liminal's lots too. That is the
deal "shared among the pickers by contribution". If hours should count per
grove instead, the pickers would need one Collectors holon per grove.

### 5. Locations

Liminal and Casa Selva change nothing — but read what their existing splits
will do with the oil, because the cascade follows them:

- Liminal today keeps 56 % for its contributors by equation and sends the
  rest to rings that hold Casa Selva (ring 2), Lunation (ring 4) and five
  people. Part of Liminal's oil therefore reaches Casa Selva and Lunation.
  If the house should keep its oil, Liminal's admins set Contributors to
  100 % or a custom split naming the house.
- Casa Selva keeps 86 % for its contributors and places nobody: it keeps the
  rest ("retained" in the diagram).

The cascade stops three hops below the root and never goes round a loop.

## The season

1. **Weights.** Set or adjust each grove's shares if the deal changes.
2. **Harvest days.** Tasks in the Collectors group; pickers join and log hours.
3. **The press.** The bill goes in as an expense, in EUR, paid by whoever paid.
4. **The cook, the tools.** Rings or appreciations, as decided above.
5. **Mint.** When a lot is back from the press, an attester of its grove
   records it: kiosk Flows gear → **Fund** → _What the fund holds_ → amount
   `200`, unit `L`, memo "first pressing 2026"; or `/fundmint 200 L first
   pressing` in the grove group; or MCP `flow_mint_record`. One mint per
   lot is fine; they add up per unit. A wrong lot is voided by a dispute
   (`/funddispute`, kiosk, web), never by editing.
6. **Everyone sees their litres.** A grove's Flows board draws its pot in L
   and every leaf of the cascade; each person's _Your balance_ card shows
   their right in L. The Collectors' own board shows the litres reaching it
   from every grove as its pot and divides them by its equation. A picker's
   OWN board (their personal holon) lists the litres reaching them from every
   hub they keep, under _Reaching you_ — the hubs the kiosk and the web
   remember for them, and the ones the bot remembers when it first records
   them there.
7. **Redeem.** A picker claims in the Collectors group (`/fundclaim 12 L`,
   or the kiosk/web claim form). The form shows their maximum — their share
   of the pot less what they already claimed, were paid, or still have
   awaiting attestation — and refuses more; a claim that slips past it (an
   older client, a stale pot) folds as _over_: kept and shown, never counted.
   An attester attests if the rules ask for it and records `/fundpaid <id>`
   when the oil is handed over. The Collectors as a whole, and each location,
   claim their half from the grove in the same way, in their own log; the
   grove's admins mark it paid when the oil moves. A picker who wants a
   neighbour to collect for them gives part of their access instead
   (`/fundgive 5 L @neighbour`, or _Give_ beside _Claim_ on the kiosk and
   the web): their access drops by five litres, the neighbour's rises by five,
   and the neighbour claims as anyone does.
8. **New moon.** The bot checkpoints each log per lunar cycle; readers can
   compare their fold against the holon's root.

## On chain (Sepolia)

The same splits run on Sepolia as Bundle contracts, deployed by the
collective's wallet `0xb2DA94d13735aF2DDCF5a3c797547290221f3DBb` (the
`ETH_PRIVATE_KEY` in the root `.env`; the same key in MetaMask shows every
payout land). Each address is recorded on its holon's settings document
(`bundle`), so the kiosk Fund tab and the web editor read it, and every
one is a Sourcify exact match.

| holon             | Bundle                                       |
| ----------------- | -------------------------------------------- |
| Liminal grove     | `0xdf96fd6F85A63212730669fd43Fd80Be91e526E1` |
| Casa Selva grove  | `0xe54721403752054dA3AaDcD923550095FbBC060B` |
| Collector's guild | `0x277A9981c3214819eE0204Ee5f4D35f4D7897C27` |
| Liminal           | `0xDd6862Cd372376e6BBfED08172652eBd0aad3E85` |
| Casa Selva        | `0x8dCBf6F22b3F6f23032d0522D76cd61121A35172` |

The grove ids are `holon_fig33pftaepw96i4` (Liminal) and
`holon_ccdhuztubkrs5thm` (Casa Selva), key-founded on 2026-10-06; their
Bundles were deployed the same day. The retired mother's Bundle,
`0xB634A9352cb6dc7905A7a51240095C9F9123802C`, stays on chain with the demo
vouchers it holds; the mother's split and links were cleared and nothing
new goes to it.

Bound: each grove pays its two seats to the location's and the guild's
Bundles; Liminal pays its Casa Selva ring to the Casa Selva Bundle;
Roberto's seat is bound to the wallet in the guild, Liminal and Casa Selva.

**The oil itself is the EVO voucher**, an ERC-20 at
`0x46CfAd0408Fe97042E7f16f6dC82B12978Fea6d3` (`contracts/src/EvoVoucher.sol`,
Sourcify exact match): one EVO is one litre, 18 decimals. Only its owner, the
collective's wallet, mints — one `mint(to, litres, memo)` per pressed lot,
the on-chain twin of the `flow_mints` entry in that lot's grove. The lot is
then handed to the grove's Bundle (`transfer`) and `reward(evo, litres)`
there divides it in one transaction: half into the location's Bundle, half
into the guild's, each divided again. Because the grove's split is static
and the lot already names its grove, no re-sync is needed per lot. A holder
`redeem(litres, memo)`s by burning when the oil is collected — the on-chain
twin of a `payout`. Vouchers held by a Bundle for an unbound member are
released with `claim(id, wallet)` (kiosk Fund tab → Bind). ETH sent to a
Bundle flows the same way, but the collective's unit is litres.

**What the contract holds is on the Fund tab** (kiosk Flows → gear → Fund,
web Fund allocation editor), read live from the chain without a wallet: per
unit — ETH and every token the Bundle record lists — the balance, how much
of it waits for members who have not bound a wallet, how much was received
but not divided, and what waits for the person looking. "Track" with a
token address lists another ERC-20 on the record (core `addBundleToken`);
EVO is listed on every record. These are the Bundle's own books, shown
beside the split, never added to the pot: the lot in the mints log and its
vouchers in the contract are one lot.

Two things the chain cannot know on its own: an equation-mode roster is a
snapshot, so re-sync ("Save on chain") after hours are logged; and an
exterior share with nobody on the rings (the guild's 20 %, Casa Selva's 14 %)
stays as free balance in that contract, pushed through the split again by
the next `reward()`.

## The Pot: rights committed at each new moon, collected in one transfer

The Bundle pushes: `reward()` pays every seat and a seat that is a contract
runs its own `reward()` in the same transaction, so gas grows with the chain,
everyone is paid whether they want it or not, and every re-split needs a
`syncAll` at every level. The **Pot** (`contracts/src/Pot.sol`, bytes in
`pot-artifact.ts`) holds instead. It never splits: who holds a right over
the pool is decided off-chain and committed once per lunation as the Merkle
root of a **rights table** — one row per final holder and token, carrying
the holder's cumulative amount and payout address.

    cumulative(party) at moon e = cumulative at moon e−1
                                + share(party) at moon e × what the Pot received in lunation e

`share` is the party's leaf of the flattened cascade (grove → guild → picker
reads as one row for the picker); `received` is the contract's own counter,
so a table never declares more than the Pot has, and the rows of a token add
up to its receipts exactly (`rights.ts` `advanceRights`, largest-remainder
rounding in base units). Past lunations are never redone: a re-split only
touches later income.

What the contract enforces: at most one root per mean lunation; a posted
root waits out a challenge window (3 days by default) before it pays, the
previous root stays in force meanwhile, and the owner can veto it; the
totals a root declares never exceed receipts and never decrease; a claim
pays `cumulative − released` to the committed address only, bounded by the
committed total, and a replay pays nothing. Roots are posted by a quorum of
signers (EIP-712 `Root`, self-held wallets — never the bot's or a derived
key). Signer changes wait out the same window.

The cycle, on every surface (kiosk Flows → _The Pot_, web Flows, MCP
`pot_*`, bot at the new moon):

1. **Deposit**: send tokens to the Pot (`deposit`, or a plain transfer then
   `sweep`; ETH by plain transfer). Deposits count toward the lunation they
   arrive in.
2. **Cut** (new moon): `cutRights` walks the cascade and advances the last
   committed table by this lunation's receipts. A walk cut short publishes
   nothing — the income rolls into the next moon. The bot does this on its
   own for every holon with a Pot.
3. **Publish**: the table goes on the holon's `flow_rights` log (kind 1808,
   attesters only); its entry id is the `tableRef` the Pot stores, so every
   claimant can build a proof and every reviewer can rebuild the table
   during the window and compare roots (`rights-log.ts`, `rightsRegression`).
4. **Sign and post**: each signer signs the commitment with their wallet; the
   signature rides on an attestation of the table, so the log's quorum and
   the contract's are one gesture. Anyone posts once the threshold is in.
5. **Collect**: a row's holder (or anyone for them) sends `claim` with the
   proof; the Pot pays the row's address the difference since last time.

A party is paid at the address on their own settings document
(`settings.payout`, their own key's word — "Use this wallet"); it applies
at the next new moon, and a party with none accrues until they set one. A
holon that keeps part of its share is paid into its own Pot on the same
chain, where its own table divides it next moon.

Value held in a Pot is collected there and nowhere else: an inbound right
from a holon with a Pot is marked `heldAt` and left out of the downstream
claimable pot; a Pot-held unit's pot IS the Pot's receipts (a mint in the
same unit is the same lot); and a claim in that unit on the `flow_claims`
log gets a zero ceiling.

Open, plainly: the whole lunation's income is divided by the split as it
stands at the cut-off, so a split moved just before the new moon captures
the month — the window makes it visible and vetoable. A settings document
that has not arrived looks like a holon with no split; that is also what the
window is for.

## Where each rule lives

| rule                                      | where                                                                                                                                                                                                                                                                            |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the split, custom shares, holons as seats | `@holons/core/flows` `allocation.ts`, `settings.ts` (`settings.allocation`)                                                                                                                                                                                                      |
| a share divided again                     | `cascade.ts`, `cascade-load.ts` (children scored via `score-load.ts`)                                                                                                                                                                                                            |
| what the fund holds                       | `mints.ts` (log `flow_mints`, kind 1808), `mints-load.ts`                                                                                                                                                                                                                        |
| what reaches a holon from upstream        | `inbound.ts` (`inboundRightFrom`, `loadInboundRights`)                                                                                                                                                                                                                           |
| the pot to divide, per unit               | `pot.ts` (`potUnits`, `potTotal`)                                                                                                                                                                                                                                                |
| claims, gives, attestations, payouts      | `claims.ts` (log `flow_claims`: `claim`, `transfer`, `payout`) — see [`protocol.md`](./protocol.md)                                                                                                                                                                              |
| the access a claim or a give is judged by | `ceiling.ts` (`claimCeilings`, `claimHeadroom`: the ceiling plus received less given), `ceiling-load.ts` (`loadClaimCeilings`, for the MCP and the bot); `usage.ts` `movedOf`, `fundAccount`                                                                                      |
| the Pot: the rights table and its root    | `rights.ts` (`advanceRights`), `rights-tree.ts`, `rights-log.ts` (log `flow_rights`), `rights-cut.ts` (`cutRights`), `pot-contract.ts`, `payout.ts`; `contracts/src/Pot.sol`                                                                                                     |
| the value equation                        | `@holons/core/scoring` (`currencies.hour`, `currencies.euro`)                                                                                                                                                                                                                    |
| surfaces                                  | kiosk `FlowsView.svelte` + `AllocationSettings.svelte` (Fund, Contributors, Zones, Rules), web `flows/Flows.svelte` + `AllocationEditor.svelte`, MCP `allocation_*` / `flow_*` (`flow_transfer_record` for a give), bot `/fundmint` `/fundmints` `/fundclaim` `/fundgive` `/fundattest` `/funddispute` `/fundpaid` `/fundpolicy` |

## Limits, plainly

- An equation-mode holon downstream is scored from its own ledger on every
  board read; a holon with no events yet keeps its share ("retained").
- Units do not convert. A fund in L and a fund in EUR are two diagrams and
  two rights, and a claim names its unit.
- No double-spend protection beyond the log's rules: a payout consumes one
  claim once; scarce goods settle in the world, the log records that they did.
- A give is not bearer: it names a party the holon can name (a member, a
  linked key, a partner holon). A key nobody vouches for cannot claim what
  it received until it is linked.
- A right reached only through ANOTHER member's split (the picker seated by
  the Collectors, not by a grove) shows on the upstream boards, not under
  _Reaching you_ on the picker's own board: the climb reads the hubs a person
  keeps and the splits that name them, not every cascade they appear in.
- The MCP and the bot judge claims without the collective's expense queue
  (apps fetch OpenCollective themselves), so for an OC-funded fund their
  ceilings can be a little more permissive than the kiosk's.
- The kiosk cannot log hours yet; use the bot buttons or the web task modal.
- The bot's `/fundmint` and `/fundmints` reach production only when the
  production bot is redeployed from this branch.
