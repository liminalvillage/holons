# The REA ledger: every economic interaction, accounted by core

Holons keeps a ValueFlows ledger per holon in the `rea_events` lens: a stream
of `vf:EconomicEvent`s (what happened), `vf:Commitment`s (what someone
promised) and `vf:Intent`s (what is wanted or offered). Every interface —
the Telegram bot, the kiosk, the dashboard, the MCP server — writes to it the
same way, because none of them writes to it directly: **the ledger is derived
from the records the interfaces already persist**, by `@holons/core`.

## How it works

`createHoloSphere` (`@holons/core/holosphere`) attaches a **ledger
projection** to every instance it builds (`attachLedger`, in
`@holons/core/rea`). After each `put` / `delete` on a lens with economic
meaning, the projection reads the written document and brings `rea_events`
in line with it:

```
holosphere.put(holon, 'quests', quest)      ──►  quest stored
                                                  └─► planLedger(...)
                                                        ├─ upsert  quest:initiated   (stable id)
                                                        ├─ upsert  quest:joined ×N   (commitments)
                                                        ├─ upsert  quest:time_logged
                                                        └─ retract quest:joined for whoever left
```

- **Stable ids.** Events are keyed on the thing they describe — the expense
  id, the booking id, the (quest, member) pair — so re-writing a document
  upserts instead of duplicating.
- **Reconciliation by subject.** Each lens owns a set of kinds; events of
  those kinds that point at the written document and are no longer derived
  from it are retracted (a member who left, a split that shrank, a
  reservation cancelled before it started). Observed history is never
  retracted this way: a purchase stays bought after the line is cleared, a
  return stays returned.
- **Best-effort, never blocking.** A ledger failure is logged; the primary
  write has already succeeded.
- **Skipped on purpose:** private (password) writes, global tables, hologram
  pointers and federation propagation copies. A write redirected by a
  hologram is accounted where it lands (the owner holon).

Turn it off only for raw tooling: `createHoloSphere({ ..., ledger: false })`.

## What gets recorded, from which write

| Interaction | Lens written | Ledger record | ValueFlows |
|---|---|---|---|
| Create a quest / task / event | `quests`, `events` | `quest:initiated` | event, `work` |
| Join / claim a quest | `quests` | `quest:joined` | **Commitment**, `work` (finished on completion) |
| Log hours before completion | `quests` (`timeTracking`) | `quest:time_logged` | event, `work` |
| Complete a quest | completion plan (`@holons/core/tasks`) | `quest:completed`, `appreciation:*`, `quest:time_logged` + hour expenses | priced by the value equation |
| Delete an unfinished quest | `quests` | retracts the above | |
| Publish a need / list an offer or request | `quests` (`type`) | `need:published`, `offer:listed`, `request:listed` | **Intent** |
| A response is claimed on a need | `quests` (`claimedResponseId`) | `need:claimed` | **Commitment** |
| Record / edit / delete an expense or settle-up | `expenses` | `expense:paid` + `expense:share` per sharer | event, `transfer` |
| `/appreciate @user 3` | `appreciations` | `appreciation:sent` + `:received` | event, `transfer` |
| Add / remove a library item | `library` | `item:listed` / `item:delisted` | event, `raise` / `lower` |
| Borrow (book) an item | `library` (`bookings[]`) | `item:borrowed` + `item:fee_paid` | event, `transferCustody` / `transfer` |
| Return an item, cancel a reservation | `library` | `item:returned` / retraction | |
| Tick a shopping-list line | `checklists/shopping` | `shopping:bought` | event, `transfer` |
| Take / release a role (permanent or day) | `roles` | `role:taken` / retraction | **Commitment**, `work` |
| Stock add / use / count / transfer | written directly as `stock:*` | unchanged | |
| Sign up for / drop a shift | relay (kind 31925) — see below | `shift:accepted` / retraction | **Commitment**, `work` (hours) |

The completion family is the one thing not derived here: completing a quest
runs `planTaskCompletion` + `executeCompletionPlan` in every UI, because it
prices the events with the holon's value equation. The projection uses the
same stable ids, so the two never double-count; the initiative keeps its
creation date.

## Shifts are the one explicit call

A shift RSVP is a kind-31925 Nostr event published straight to the relays
and never passes through a lens, so the projection cannot see it. After a
successful `publishRsvp`, the bot (`Shifts.js`) and the kiosk (`shifts.ts`)
call `recordShiftRsvp(holosphere, holonId, { occurrence, member, status })`
from `@holons/core/shifts`. Signups made from other apps (Elinor) are not
mirrored.

## The planning layer

Commitments and intents live in the same `rea_events` stream as events,
distinguished by `vfType: 'Commitment' | 'Intent'`. They may carry no
measure (the hours are unknown until logged) and gain `finished: true` when
the quest completes or the need is fulfilled. `toValueFlowsJsonLd` exports
them as `vf:Commitment` / `vf:Intent`. Existing readers key on `eventType`
and ignore kinds they do not know, so scores, balances and flows are
unaffected by the planning records.

## Where things live

- `packages/core/src/rea/valueflows.ts` — the ontology: actions, kinds → actions (`EVENT_KIND_MAPPINGS`), normalization, JSON-LD.
- `packages/core/src/rea/event-factory.ts` — one method per kind, stable ids.
- `packages/core/src/rea/ledger.ts` — `planLedger`: lens document → upserts + retractions (pure, tested per lens).
- `packages/core/src/rea/attach.ts` — `attachLedger`: the `put`/`delete` wrapper.
- `packages/core/src/shifts/ledger.ts` — `recordShiftRsvp`.
- `packages/core/src/library/deposits.ts` — borrow/return still mirror the credit charge into `expenses`; the REA side now comes from the projection.
