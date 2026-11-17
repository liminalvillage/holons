<!--
SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# The quest board

A **quest** is something a group sets out to do that needs resourcing before
it can happen: a goal, what it needs (each a quantity in its own unit), and a
time box. People meet quests one card at a time in Flows, say yes or no, and a
yes opens what the quest needs and who is in. When every need is covered the
quest is **assembled** — it's on — and the pledges are due. When the time box
ends first it **lapses** and the pledges are released.

The design came out of two outside reviews of coordination apps (the
"possibility" feed on Springforth, and Pastry, another Artizen clone): lead
with what people want to make happen, earn the detail with a yes, keep the
coordination lateral.

## Where it lives

One append-only log, `quest_board` (kind 1808), on a **board holon**. A quest
is filed under a **fund** — nothing comes straight from the Pot — and a person
watches the boards of the funds they follow at once (`watchQuestBoards`; each
quest carries its `board`). An event's holon (`?board=<holon>` in Flows) is a
board of its own. Anyone may append — whoever proposes, joins or pledges is by
definition not a member of the board — so the log does not run the usual
author rule, like `flow_project_claims`. Every entry names its quest in its
body, never in `basis`: a basis is consumed, and many people join one quest.

Core: `@holons/core/tasks` — `board.ts` (pure builders and the fold),
`board-feed.ts` (the order cards are dealt in), `board-load.ts` (store I/O).
The lens is registered in `APPEND_LENSES` (`holosphere/factory.ts`).

## The entries

| kind | body | who counts |
| --- | --- | --- |
| `propose` | `party, title, summary?, until (ms), needs[{label, quantity, unit?}], holon?, name?` | anyone; the quest id is the entry id, needs are `n1…` |
| `join` | `quest, party, level: in \| curious, name?` | the party's own key (below) |
| `leave` | `quest, party` | the party's own key |
| `pledge` | `quest, need, party, quantity, note?, name?` | the party's own key; never to a `people` need |
| `unpledge` | `pledge, party` | only the pledge's own signer |
| `need` | `quest, party, label, quantity, unit?` | anyone; the need id is the entry id |
| `close` | `quest, party, outcome: done \| cancelled` | the proposer, or an admin of the board |

A party's word counts from the first key that spoke for it on that quest, or
from a key seen to speak for it (its own pubkey holon, or a linked key) —
nobody else moves its standing.

## The fold

`foldQuestBoard` turns the log into `BoardQuest`s, which keep the tasks
`Quest` shape (`id`, `title`, `description`, `type: 'quest'`,
`initiator: {id}`, `participants`, `ends`, `status`) so the helpers that read
quests read these too. On top:

- a need in unit `people` is a headcount, covered by how many are in; any
  other need is covered by the sum of live pledges, capped at its quantity;
- `coverage` is the mean of each need's covered share;
- the first moment every need is covered sets `assembledAt`, and the quest
  stays assembled after that even if someone leaves;
- past `until` without `assembledAt` it is lapsed: later entries are ignored
  and pledges read as released;
- a closed quest (done or cancelled) stops moving.

## The deck

`rankQuests` deals only open quests the viewer has not decided on. Closest
to tipping first (coverage, then people in); quests from or joined by people
the viewer would work with again are lifted, those from people they would
not are lowered; a quest nobody has moved for seven days sinks to the end.

The viewer's yes and no, and their "would work with again" ratings after a
quest is done, stay on their device (`apps/flows/src/lib/questDeck.ts`). The
board only ever hears a join, a pledge or a need — never a no.

## Surfaces

- **Flows** — `/quests`: the funds I follow (by default those that pay me,
  then the largest; added and dropped from a picker), Discover (the deck
  over their boards) and Following (what I said yes to, joined, pledged to
  or proposed; assembled first). Proposing asks under which fund. Signed out, anyone can
  swipe; joining, pledging and proposing need a key that signs.
- **MCP** — `quest_board_list`, `quest_propose`, `quest_join`,
  `quest_pledge`, `quest_add_need`, `quest_close`.

## Not yet

Chat per quest, sub-quests for very large goals, place-based ranking,
importing interests from elsewhere, and turning delivered pledges into
counted gifts on the receiver's resource base.
