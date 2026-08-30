# Community shifts — Elinor format

HolonsBot can read and sign up for community shifts published in the
[Elinor](https://elinor.commonshub.dev/docs) format, so a Telegram group can
use HolonsBot and Elinor (or any other Elinor client / ICS feed) against the
same schedule.

## The format, in one screen

Plain NIP-52-style addressable Nostr events on a relay. `groupId` is the
Telegram chat id — i.e. the holon id.

| kind  | role       | `d` tag                          | key tags                                                                    |
|-------|------------|----------------------------------|-----------------------------------------------------------------------------|
| 31923 | occurrence | `shift-<groupId>-<date>-<code>`  | `title` `start` `end` (unix s) `start_tzid` `location` `capacity` `t:shift` `t:<code>` `t:group-<groupId>` |
| 31925 | signup     | `rsvp-<groupId>-<date>-<code>`   | `a = 31923:<coordinator>:<occurrence d>` `status = accepted\|declined` `t:shift` `p <actor> "" changed-by` (optional) |

Resolution: for each `(author, a)` the RSVP with the highest `created_at`
wins; ties go to the lexically smallest `id`. A person is enrolled iff their
latest RSVP is `accepted`. Cancelling republishes with `declined` (history is
kept). Capacity is cooperative — the relay does not enforce it. The relay
rejects an RSVP whose `created_at` does not strictly exceed the author's
previous one for the same `d`.

Only the coordinator publishes 31923; participants (or the bot on their
behalf, under *their* key) publish 31925.

## Where it lives

- **`@holons/core/shifts`** — all rules: d-tag/address builders and parsers,
  `parseShiftOccurrence`, `parseShiftRsvp`, `resolveRsvps`, `enrolledPubkeys`,
  `hasCapacity`, `buildRsvpTemplate`, the REQ filters, and
  `createShiftRelayClient({ relays, coordinatorPubkey })` which fetches,
  resolves and signs against a `nostr-tools` pool (injectable for tests).
- **`packages/telegram-ui/src/Shifts.js`** — rendering + Telegraf wiring only:
  `/shifts [today|tomorrow|week|YYYY-MM-DD]`, `/myshifts`, and the inline
  `✋ Take` / `❌ Drop` buttons.
- **`@holons/core/auth` → `deriveTelegramNostrKey`** — the per-member signing
  key, shared with the web login so a member has one pubkey everywhere.

## Configuration (root `.env`)

```
SHIFTS_RELAYS=wss://relay.holons.io      # falls back to HOLOSPHERE_RELAYS
SHIFTS_COORDINATOR_PUBKEY=<hex>          # trust only this author's 31923s
NOSTR_DERIVATION_SECRET=<same as web>    # required for signups
```

Without `NOSTR_DERIVATION_SECRET` the bot can still list shifts but refuses
to sign up. Without `SHIFTS_COORDINATOR_PUBKEY` any author's occurrences are
shown — fine for development, set it in production.

## Identity caveat

Elinor and Holons derive per-user keys independently, so the same person has
a different pubkey in each bot. Signups made through HolonsBot are counted by
Elinor (it counts unknown pubkeys) but shown without a name until the pubkey
is introduced to it; the reverse holds for Elinor signups shown by HolonsBot
(rendered as `<8 hex>…`). Sharing keys or a name-registry is future work.

## Holons data as NIP-52 (projections)

With `HOLOSPHERE_PROJECTIONS=quests,events` the bot ALSO publishes each
dated quest/event as a kind-31923 (or 31922) event tagged
`t=group-<chatId>`, plus one 31925 RSVP per participant signed with the
member's derived key (needs `NOSTR_DERIVATION_SECRET`). Elinor-style readers
filter by kind + `#t`, not by `d`: Holons uses `d = holons:<lens>:<holon>:<id>`,
not Elinor's `shift-<group>-<date>-<code>`, so `parseShiftOccurrence` will not
parse them. See `packages/holosphere/NOSTR-BACKEND.md` → Projections.

And back: a 31925 RSVP against a **Holons** event, signed with a member's
derived key (from any client — Elinor-style bots, a NIP-52 app, `/shifts`),
adds or removes that member in the event's `participants[]`; a 31923 edit by
the holon key updates title/time/location. Keys the bot does not know are
ignored (`NOSTR-BACKEND.md` → Mutual update). Elinor's own occurrences are
still not imported as Holons records.

## Not (yet) covered

- Publishing Elinor-grammar occurrences (acting as coordinator) — Holons
  roles are day-granular and capacity-free; a `shifts` entity would be needed.
- Per-shift reminders and the pinned daily message.
- Calendar (ICS) feeds for shifts.
