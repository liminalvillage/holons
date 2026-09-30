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
Olive Collective  (the mother — a Telegram group with the bot)
│  fund   = the season's oil, minted in L by an attester
│  split  = Contributors share 100 %, divided by hand-set weights:
│           Liminal 25 · Casa Selva 25 · Collectors 50
│
├─▶ Liminal       ─ its own split ─▶ its members and rings        (cascade)
├─▶ Casa Selva    ─ its own split ─▶ its members                  (cascade)
└─▶ Collectors    (the pickers — a Telegram group with the bot)
       fund   = what reaches it from the mother (its 50 %)
       split  = Contributors ~80 %, by the value equation
                 (hours weigh most; euros paid for the press weigh too)
                Reciprocity zones ~20 %, people on rings: the cook, the tool lenders
```

Three ideas carry the whole thing:

- **A seat is a holon.** In a custom split, a contributor row can be another
  holon, not only a person. The mother seats its two locations and the
  Collectors with weights; what each receives is then divided again by that
  holon's own split — the cascade. A location that never configured a split
  keeps what it gets.
- **The pot is whatever was minted.** A fund used to be OpenCollective money
  only. Now an attester appends a `mint` (amount, unit, memo, source) and
  that is what the split divides, in that unit. Litres stay litres: nothing
  converts, and a holon holding euros and oil has two pots.
- **A right is redeemed, never transferred.** Every person and holon on the
  cascade sees their litres as a right in their Fund account. They `claim`
  it in the holon where they are a member; an attester attests and records
  the `payout` when the oil is handed over. Same log, same rules, same fold
  as money claims.

## Setting it up

### 1. The holons

Two new Telegram groups with @HolonsBot in them: the **Olive Collective**
(mother) and the **Collectors**. Every chat the bot is in is a holon (id =
chat id). Liminal (`-1003864542239`) and Casa Selva (`-1002964866719`) already
exist.

Admins of the mother group are its attesters by default — they mint, attest
and mark payouts. Admins of the Collectors group are the attesters there.

### 2. Federation

The mother links the three: on the web `/<mother>/federation`, in the kiosk
Federation lens, or via MCP `federation_link_add`. No lenses need to flow
either way for the split to work; the link is what lets a partner be seated
and what lets the child find its upstream.

The Collectors, Liminal and Casa Selva each see the mother as a partner
automatically (the link is mirrored).

### 3. The mother's split

Kiosk: Flows → gear → **Contributors** → _Custom split_ → add each partner
holon from the picker (they appear as "Liminal (holon)" etc.) and type the
weights. **Split**: Contributors share 100 % (the zones are unused here).
Web: the Fund allocation panel's editor does the same. MCP:

```
allocation_save { holon: <mother>, interiorPercent: 100, interiorMode: "custom",
                  shares: { "-1003864542239": 25, "-1002964866719": 25, "<collectors>": 50 } }
```

Or run the seed script once the two groups exist — it links the partners,
saves the mother's split and the Collectors' equation and split in one go:

```
node --env-file=.env scripts/seed-harvest-collective.mjs \
  --mother <mother chat id> --collectors <collectors chat id> \
  --location -1003864542239=25 --location -1002964866719=25 --collectors-weight 50
```

Weights are read against their own sum: 25/25/50, 1/1/2 or 30/20/50 are all
splits. Change them per season when the yield per location is known; what
was already claimed stays as it was (a claim freezes its share).

**Rules** (kiosk Rules tab, web Rules, `/fundpolicy`): pin the three
partners so their claims fold into the mother's statement
(`/fundpolicy pin <holon id>` in the mother group, once each). The claims
log and the mints log each take their own policy; admins attest both by
default.

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

1. **Weights.** Set or adjust the mother's shares for this year's yield.
2. **Harvest days.** Tasks in the Collectors group; pickers join and log hours.
3. **The press.** The bill goes in as an expense, in EUR, paid by whoever paid.
4. **The cook, the tools.** Rings or appreciations, as decided above.
5. **Mint.** When the oil is back, an attester of the mother records the
   lot: kiosk Flows gear → **Fund** → _What the fund holds_ → amount `200`,
   unit `L`, memo "first pressing 2026", source the location if it matters;
   or `/fundmint 200 L first pressing` in the mother group; or MCP
   `flow_mint_record`. One mint per lot is fine; they add up per unit.
   A wrong lot is voided by a dispute (`/funddispute`, kiosk, web), never
   by editing.
6. **Everyone sees their litres.** The mother's Flows board draws the pot in
   L and every leaf of the cascade; each person's _Your balance_ card shows
   their right in L. The Collectors' own board shows the litres reaching it
   as its pot and divides them by its equation.
7. **Redeem.** A picker claims in the Collectors group (`/fundclaim 12 L`,
   or the kiosk/web claim form); an attester attests if the rules ask for
   it and records `/fundpaid <id>` when the oil is handed over. The
   Collectors as a whole claim their 50 % from the mother in the same way,
   in their own log; the mother's admins mark it paid when the oil moves.
8. **New moon.** The bot checkpoints each log per lunar cycle; readers can
   compare their fold against the holon's root.

## Where each rule lives

| rule                                      | where                                                                                                                                                                                                                                                                            |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the split, custom shares, holons as seats | `@holons/core/flows` `allocation.ts`, `settings.ts` (`settings.allocation`)                                                                                                                                                                                                      |
| a share divided again                     | `cascade.ts`, `cascade-load.ts` (children scored via `score-load.ts`)                                                                                                                                                                                                            |
| what the fund holds                       | `mints.ts` (log `flow_mints`, kind 1808), `mints-load.ts`                                                                                                                                                                                                                        |
| what reaches a holon from upstream        | `inbound.ts` (`inboundRightFrom`, `loadInboundRights`)                                                                                                                                                                                                                           |
| the pot to divide, per unit               | `pot.ts` (`potUnits`, `potTotal`)                                                                                                                                                                                                                                                |
| claims, attestations, payouts             | `claims.ts` (log `flow_claims`) — see [`protocol.md`](./protocol.md)                                                                                                                                                                                                             |
| the value equation                        | `@holons/core/scoring` (`currencies.hour`, `currencies.euro`)                                                                                                                                                                                                                    |
| surfaces                                  | kiosk `FlowsView.svelte` + `AllocationSettings.svelte` (Fund, Contributors, Zones, Rules), web `flows/Flows.svelte` + `AllocationEditor.svelte`, MCP `allocation_*` / `flow_*`, bot `/fundmint` `/fundmints` `/fundclaim` `/fundattest` `/funddispute` `/fundpaid` `/fundpolicy` |

## Limits, plainly

- An equation-mode holon downstream is scored from its own ledger on every
  board read; a holon with no events yet keeps its share ("retained").
- Units do not convert. A fund in L and a fund in EUR are two diagrams and
  two rights, and a claim names its unit.
- No double-spend protection beyond the log's rules: a payout consumes one
  claim once; scarce goods settle in the world, the log records that they did.
- The kiosk cannot log hours yet; use the bot buttons or the web task modal.
- The bot's `/fundmint` and `/fundmints` reach production only when the
  production bot is redeployed from this branch.
