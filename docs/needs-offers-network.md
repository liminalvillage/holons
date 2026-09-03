<!--
SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# The Geolocated Needs & Offers Network

*How a shopping list and a library of things become local economic
infrastructure — and, under stress, an emergency system.*

## 1. The premise: demand is the scarce signal

Supply chains aggregate demand invisibly. A supermarket knows what a
neighborhood buys; the neighborhood doesn't. The farmer three kilometers away
never learns that forty households nearby buy eggs every week — that signal is
captured, transported, and monetized by intermediaries, who return a fraction
of the retail price to the producer.

A shopping list is the most honest, lowest-friction demand signal a household
produces. It already exists; nobody has to fill in a form or "join a
marketplace." This network publishes that signal — **by consent, to a chosen
radius** — and lets nearby producers answer it directly.

The economics are deliberately simple: a published need is a **commitment to
purchase at market price**. The buyer pays what they would have paid at the
store; the producer earns the retail price instead of the farm-gate price.
Nobody is asked for charity, and no price negotiation platform is needed —
the market price is the coordination point. What changes is *who captures it*.

## 2. The primitives this is built on

Everything below composes existing Holons machinery; no new infrastructure was
invented for it.

- **Holons and lenses.** Every group is a holon; every data type is a lens
  (`quests`, `needs`, `library`, `checklists`, …) namespaced under it in the
  Holosphere store — signed events on relays, local-first.
- **Every H3 cell is a holon.** Geography is addressable: an H3 hexagon id is
  a valid holon id (`app/<cellId>/<lens>`), so "the map" is just holons at
  geographic addresses, from res 0 (continental) to res 14 (doorstep).
- **`settings.hex`** is a holon's declared location — picked once in
  Settings → Hex Address (web) or `/setHex` (Telegram).
- **Federation publish** (`@holons/core/federation`): partners receive
  standalone copies by default; hex cells receive **holograms** — bare
  `{id, soul}` pointers that resolve live from the owner's storage — upcast
  through the parent-cell chain so they surface at any map zoom.
- **Provenance** (`sourceRef` in `@holons/core/holosphere`): a write to a
  foreign record is routed to the holon that owns it, so a response lands on
  the canonical record instead of forking a stray local copy.

## 3. Geolocated needs: the shopping list as demand signal

A shopping-list item can be **shared as a need** (`@holons/core/needs`):

1. The item becomes a marketplace record of `type: 'need'` on the holon's
   `quests` lens — the same lens the Offers & Requests board already reads —
   with a lifecycle revived from the dormant `offers.json` schema:
   `requested → offered → claimed → fulfilled` (plus `cancelled`).
2. A `source` back-link records the originating shopping item, and the item is
   stamped with the `needId` — so checking the item off **fulfills the need
   everywhere**, and removing it retracts it.
3. Publication is consent-tiered, chosen per item at share time:
   - **Private** (default) — nothing leaves the holon.
   - **Federation partners** — standalone copies to the holons you federate
     with; status changes are pushed by re-publishing.
   - **Public map** — a hologram at the holon's `settings.hex` cell under the
     `needs` lens. The map's "Local Needs" layer lights that hexagon at every
     zoom level; because it is a hologram, fulfillment is reflected live and
     no ghost need stays lit.

## 4. The library of things: the supply-side mirror

Needs are what a place wants; the library is what a place already has. The
library domain (bookings, deposits, borrow/return) already federates between
partner holons — publishing items to the holon's hex cell puts them **on the
map**, so a neighbor discovers the ladder, the drill, or the book three
streets away before buying one. Needs and existing resources become two layers
of the same geographic picture: *what is wanted here* and *what is available
here*.

## 5. Provider response and disintermediation

Any holon that can see a need — via federation or the public map — can
**respond** to it: a message ("fresh eggs, can deliver Friday") with an
optional price. Responses are embedded on the need record (the same pattern as
library bookings) and written via `sourceRef`, so they reach the requester's
holon regardless of where the responder saw the need. The first response flips
the need to `offered`; several providers may respond; the requester's board
updates live with no notification infrastructure needed.

Fulfillment stays conversational by design in this phase — the network's job
is *visibility and matchmaking*, not escrow. Trust is local; the parties
close the loop themselves, and checking off the shopping item records the
outcome.

## 6. The need → offer flywheel *(next phase)*

Every fulfilled need is proof of capability: someone actually delivered eggs
in this hexagon. On fulfillment, the network mints a standing **offer**
attributed to the provider — published to their own holon and optionally
their hex. Providers therefore accrue a discoverable catalog **by fulfilling,
not by listing**: reputation is earned through delivery. Over time the map's
offers layer becomes an accurate, self-maintaining directory of who actually
produces what, where.

## 7. Solidarity purchase groups *(later phase)*

Because hex cells are real holons, aggregation needs no new infrastructure: a
periodic process clusters open needs under a cell by category into a
**group-buy quest living on the cell holon itself** — the Italian *Gruppi di
Acquisto Solidale* tradition, made ambient. Members join through the existing
participant operations, cost-split through the expenses domain, and one
provider response serves the whole aggregate, delivered to a doorstep or a
common hub.

## 8. Emergency mode: the same channel under stress

This is the polycrisis argument. A mutual-aid system built *after* a disaster
strikes has no users, no trust graph, and no data. A needs channel used weekly
for eggs is already populated, already trusted, and already geolocated on the
day it is suddenly needed for blankets, water, or a rescue location.

- The record type doesn't change — an urgent need is a need with an
  `urgency` field, cross-posted to the `announcements` lens of the hex and
  its partners, and rendered with priority on the map.
- The infrastructure is the part designed to survive: the store is local-first
  and any relay can carry the signed events, so the neighborhood's data lives *in the neighborhood*,
  not in a cloud that may be unreachable. And the providers the network
  surfaces are precisely the ones that keep functioning when long supply
  chains fail — they are three kilometers away.

The everyday system **is** the emergency system. It needs no adoption event,
no onboarding under duress, and no behavior change beyond what people already
do every week.

## 9. Trust, consent, privacy

- **Nothing publishes without an explicit act.** Sharing is per item, at
  share time, with partner and public-map visibility as separate choices.
- **What leaves the holon** is the item's text, category, status, and the
  publishing holon's hex — never the full list, never the member roster.
- **The hex resolution is a privacy dial**: publishing at res 7 says "this
  neighborhood wants flour"; res 14 would say "this doorstep does." Holons
  choose their own `settings.hex` precision.
- **Retraction works**: removing the item cancels the need; partner copies
  are refreshed and the hex hologram resolves to the closed record, dropping
  it from the needs layer.

## 10. Appendix: data model (phase 1)

Need record — `(ownerHolon, 'quests', needId)`, see `@holons/core/needs`:

| Field | Meaning |
|---|---|
| `type` | `'need'` (classified by `classifyMarketItem`) |
| `status` | `requested \| offered \| claimed \| fulfilled \| cancelled` |
| `title`, `category`, `initiator` | from the shopping item / sharer |
| `hex` | H3 cell the need was published to (when mapped) |
| `source` | `{ kind: 'shopping', itemId }` back-link |
| `responses[]` | `{ id, responder: { id, name?, holonId? }, message?, price?, currency?, createdAt }` |
| `published` | `{ at, toPartners?, toHex? }` publication stamp |

Projections: partner holons hold standalone copies at `(partner, 'quests')`;
the hex cell holds a hologram `{ id, soul }` at `(cell, 'needs')` pointing at
the canonical record, upcast through parent cells for map visibility. The
shopping item carries `needId` back to the need.

MCP surface: `need_publish_from_shopping_item`, `need_respond`, `need_close`,
`needs_list_at_hex`.
