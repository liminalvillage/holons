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
| 31926 | identity   | `telegram:<telegram_user_id>`    | one `p` per key currently linked to that user; `content = {"name":"…"}` |

Resolution: for each `(author, a)` the RSVP with the highest `created_at`
wins; ties go to the lexically smallest `id`. One person may act through
several keys (Elinor's coordinator-derived key plus any linked app keys, per
the 31926 attestations), and **the canonical status of a person is the
newest RSVP across all of their keys** — resolving per key instead leaves a
person enrolled after they cancel under a sibling key. In core, pass the
`ShiftIdentityMap` from `attestationIdentityMap` to `resolveRsvps` /
`enrolledPubkeys` / `isEnrolled` / `latestRsvpFor` / `hasCapacity`.
Cancelling republishes with `declined` (history is kept). Capacity is
cooperative — the relay does not enforce it. The relay rejects an RSVP whose
`created_at` does not strictly exceed the author's previous one for the same
`d` — and to win the person-level comparison it must exceed the person's
newest RSVP across all keys (`publishRsvp` looks that up via attestations
when no `previous` is given).

Only the coordinator publishes 31923; participants (or the bot on their
behalf, under *their* key) publish 31925.

## How Holons reads it

Shifts are **ordinary lenses**. The wires in `@holons/core/shifts` decode the
events above straight into Holosphere records, so every surface reads them the
way it reads quests or roles:

| call | holds |
|---|---|
| `getAll(holon, 'shifts')` | occurrences, addressed `<date>-<code>` |
| `getAll(holon, 'shifts_rsvp')` | signups, one record per person per occurrence |
| `getAllGlobal('shift_identity')` | the kind-31926 directory, one record per provider claim |

A UI opts in with `createHoloSphere({ standardWires: { shifts: {…},
shiftIdentity: {} } })`. Reading needs `relay.commonshub.dev` in the ordinary
relay list; it is in the default set.

`toOccurrence` and `toRsvp` map a record back to `ShiftOccurrence` /
`ShiftRsvp` field for field, so `resolveRsvps`, `enrolledPubkeys` and
`hasCapacity` take lens data unchanged.

The lens is **read-only on its wire** and Holosphere throws on a write to it.
Occurrences belong to the coordinator, and a signup's rule — newest across a
person's linked keys — is not a per-address write, so signups still go out
through `buildRsvpTemplate`. A standard kind also cannot carry a hologram, a
global, a federated copy or a scalespace propagation, and each of those is
refused rather than quietly degraded.

## Where it lives

- **`@holons/core/shifts`** — all rules: d-tag/address builders and parsers,
  `parseShiftOccurrence`, `parseShiftRsvp`, `resolveRsvps`, `enrolledPubkeys`,
  `hasCapacity`, `buildRsvpTemplate`, the 31926 attestation rules
  (`attestation.ts`: parse/build/resolve, `attestationNameMap`), the REQ
  filters, and `createShiftRelayClient({ relays, coordinatorPubkey })` which
  fetches, resolves and signs against a `nostr-tools` pool (injectable for
  tests). RSVPs are signed through a `NostrSigner` from
  `@holons/core/holosphere` (`createIdentityContext` / `signerFromSecretKey`)
  — no raw private key crosses a module boundary.
- **`packages/telegram-ui/src/Shifts.js`** — rendering + Telegraf wiring:
  `/shifts [today|tomorrow|week|YYYY-MM-DD]`, `/myshifts`, and the inline
  `✋ Take` / `❌ Drop` buttons. `readSchedule` reads the three lenses; names
  come from the users lens first, then the attestations that arrive with it.
- **`packages/core/src/nostr/codecs/profile.ts`** — the `users`-lens codec:
  kind 0 (with the NIP-39 `i` claim) + NIP-29 membership + the 31926
  attestation companion the projection host signs as the identity provider.
- **`apps/kiosk/src/lib/views/ShiftsView.svelte`** — a Shifts tab on the
  kiosk: the next two weeks as day rows of shift notes with capacity meters
  and participant names, fed by `apps/kiosk/src/lib/shifts.ts`, which follows
  the `shifts` and `shifts_rsvp` lenses and reads the identity directory
  alongside them. An RSVP made in Elinor lands as the relay pushes it into the
  lens, and a reload paints from IndexedDB. The tab appears by itself when the
  displayed holon has upcoming occurrences (tri-state caretaker pref, like
  Library/Roles). `VITE_KIOSK_SHIFT_COORDINATOR` pins whose occurrences are
  trusted; `VITE_KIOSK_SHIFT_RELAYS` now governs only where a signup is
  PUBLISHED, defaulting to `wss://relay.commonshub.dev`.
- **`apps/kiosk/src/routes/api/shifts/rsvp/+server.ts`** — ✋ Take / ✕ Drop
  from the kiosk, signed under the USER'S own key. Telegram logins are
  signed server-side with `deriveTelegramNostrKey` (the key never reaches
  the shared screen; same pubkey as the bot and web — needs
  `NOSTR_DERIVATION_SECRET` on the kiosk deploy, else the board is
  read-only); nsec/wallet logins sign client-side with their adopted
  session key. Publish relays: `KIOSK_SHIFT_RELAYS` →
  `VITE_KIOSK_SHIFT_RELAYS` → `SHIFTS_RELAYS` → the Commons Hub default.
- **`@holons/core/auth` → `deriveTelegramNostrKey`** — the per-member signing
  key, shared with the web login so a member has one pubkey everywhere.

## Planning and publishing — the coordinator's side

A holon's **shift plan** is its catalog of recurring shifts, kept on the
`settings` record under `shifts` and owned by `@holons/core/shifts/plan.ts`:

```ts
interface ShiftPlan { tzid; location?; horizonDays; shifts: ShiftDefinition[] }
interface ShiftDefinition { code; title; start: "HH:MM"; end: "HH:MM"; capacity;
                            enabled; description?; days?: 1..7[]; location? }
```

The catalog mirrors Elinor's (`src/shifts.js` there) field for field — the
same five seeds, the same validation (`validateShiftDefinition`), the same
code generator (`generateShiftCode`), the same 14-day horizon — so a plan
edited on a kiosk and one edited in Elinor's Mini App describe the same
schedule. `days` (ISO weekdays; absent = every day, which is what Elinor
does) and a per-shift `location` are the two extensions.

- `expectedShifts(plan, groupId, fromDate, days)` materialises the plan into
  the slots it promises, DST-safe in the plan's zone (`localToUnix`).
- `buildOccurrenceTemplate` builds the kind-31923 exactly as Elinor publishes
  it (`d`, `title`, `start`, `end`, `start_tzid`, `location`, `capacity`,
  `t:shift`, `t:<code>`, `t:group-<groupId>`; Elinor-style `content`).
  Addressable: republishing the same key **replaces** — that is the edit.
- `buildOccurrenceDeleteTemplate` builds the NIP-09 kind 5 naming each
  occurrence by `a` coordinate (and `e` id), with `k 31923`. The shift wire
  follows retractions by author when a coordinator is pinned, else by
  `#k`, and turns them into `_deleted` tombstones on the `shifts` lens.
- `reconcileSchedule(expected, occurrences, rsvps, { identity, coordinatorPubkey })`
  lines the plan up against the wall and classifies every slot:
  `unpublished` (expected, nothing on the relay), `unstaffed` (published,
  nobody), `short`, `covered`, `open` (no capacity), `stale` (published, not
  in the plan any more), plus `drifted` when the published copy disagrees
  with the plan. `coverageOf` is the per-occurrence version the board uses.
- `planFromOccurrences` adopts a plan from what is already on the relay, so
  an Elinor group gets a plan that matches its published shifts rather than
  a seed catalog that marks every one of them stale.
- `ShiftRelayClient.publishOccurrence` / `deleteOccurrences` sign and
  publish as the coordinator; a client pinned to a coordinator refuses any
  other signer.

**The coordinator key** is a service identity:
`deriveShiftCoordinatorKey(NOSTR_DERIVATION_SECRET)` (context
`service:shift-coordinator`, FROZEN — rotating it orphans every occurrence
and the RSVPs addressed to them), exposed as `coordinatorSigner()` on
`createIdentityContext`. Every surface holding the secret derives the same
key, so the bot, the web and a kiosk all publish ONE coordinator's schedule.
Pin its pubkey as `SHIFTS_COORDINATOR_PUBKEY` / `VITE_KIOSK_SHIFT_COORDINATOR`
in production.

**On the kiosk** the ⚙ on the Shifts board (login-gated) opens
`ShiftSettings.svelte`: the catalog editor (add / edit / disable / remove
shifts, days, people needed, place, zone, horizon) beside **the wall as the
kiosk will show it** — the same `ShiftNote.svelte` the board draws, over
the live signups, with ghost notes for unpublished slots, a loud dashed ring
on published shifts nobody has taken, "short of hands" counts, and flags for
stale / drifted shifts. Publish, republish and retract act per note or in
one go ("Publish N missing", "Remove N not in plan"); "Save plan" writes the
settings record through core. The board itself now headlines the gaps
("N shifts with nobody · M spots still open") and rings unstaffed shifts.
`apps/kiosk/src/routes/api/shifts/occurrence/+server.ts` does the signing:
`GET` → `{ pubkey, allowed }`, `POST { occurrences }` → publish (batch),
`DELETE { occurrences }` → one retraction. Any logged-in Telegram session
may drive it unless `KIOSK_SHIFT_MANAGERS` (comma-separated Telegram ids)
narrows it; key logins cannot (the coordinator is not their identity). Both
verbs answer 501 without `NOSTR_DERIVATION_SECRET`, and 409 when the deploy
pins a different coordinator (ours would never show).

## Configuration (root `.env`)

```
SHIFTS_RELAYS=wss://relay.holons.io      # falls back to HOLOSPHERE_RELAYS
SHIFTS_COORDINATOR_PUBKEY=<hex>          # trust only this author's 31923s
NOSTR_DERIVATION_SECRET=<same as web>    # required for signups + attestations
SHIFTS_IDENTITY_BLACKLIST=               # optional: 31926 providers to ignore
KIOSK_SHIFT_MANAGERS=                    # optional: Telegram ids allowed to publish/retract occurrences
```

Without `NOSTR_DERIVATION_SECRET` the bot can still list shifts but refuses
to sign up. Without `SHIFTS_COORDINATOR_PUBKEY` any author's occurrences are
shown — fine for development, set it in production.

## Identity attestations (kind 31926)

Elinor and Holons derive per-user keys independently, so the same person has
a different pubkey in each bot. Kind 31926 is the name registry that bridges
them: any app may act as an identity provider (no registration) by publishing
`{d: telegram:<id>, p: <every key linked to that user>, content: {"name"}}`.
Addressable — republishing the same `d` **replaces** the provider's previous
list, so the `p` set must always be the user's complete key set: an omitted
key is unlinked. Elinor honors attestations from any provider by default
(governance is a community blacklist), and its coordinator publishes the same
directory for every member it manages — `{kinds:[31926],
authors:[<coordinator>]}` is the authoritative Telegram↔npub mapping.

How Holons plays both sides:

- **Publishing (provider role)** — the holosphere **projection layer** emits a
  31926 companion beside each member's kind-0 profile (`users` lens), signed
  by a service-level provider key derived from `NOSTR_DERIVATION_SECRET`
  (`deriveIdentityProviderKey`, context `service:identity-provider` — same
  secret ⇒ same provider key on every surface, so republishes replace rather
  than duplicate). Deduped: an unchanged (pubkey, name) pair is not re-sent.
- **NIP-39 claim** — the projected kind 0 also carries
  `["i","telegram:<id>"]` (numeric ids only, no proof element): Elinor sees
  it and asks that Telegram member to confirm the link with one tap.
- **Consuming** — the bot's `/shifts` board and the kiosk resolve signup
  pubkeys the local `users` lens cannot explain through 31926 attestations.
  Both read them from the global `shift_identity` lens alongside the
  schedule, then `attestationNameMap`.
  Precedence: local lens name →
  coordinator directory → other providers (newest wins) → `<8 hex>…`.
  `SHIFTS_IDENTITY_BLACKLIST` (comma-separated provider pubkeys) mutes
  misbehaving providers. The same attestations feed
  `attestationIdentityMap` — pubkey → person, guarded read-side (the
  coordinator key is never claimable, a key linked to one person is never
  remapped: coordinator outranks, then earliest link wins) — which both
  boards pass into RSVP resolution so one person's keys count as one signup.

**Relay overlap matters**: attestations and kind-0 claims ride the projection
publishers, i.e. `HOLOSPHERE_RELAYS` — that list must include the shifts
relay (e.g. `wss://relay.commonshub.dev`) for Elinor to see them. And only
members with a `users`-lens record are attested: someone who signs up via
the kiosk without ever appearing in a holon roster stays a bare pubkey until
they do.

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

- Materialising the plan on a schedule (Elinor's daily cron) — publishing
  is a caretaker action from the kiosk today; the bot does not yet
  republish the horizon by itself.
- Per-shift reminders and the pinned daily message.
- Calendar (ICS) feeds for shifts.
