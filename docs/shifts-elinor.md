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
  `hasCapacity`, `buildRsvpTemplate`, the 31926 attestation rules
  (`attestation.ts`: parse/build/resolve, `attestationNameMap`), the REQ
  filters, and `createShiftRelayClient({ relays, coordinatorPubkey })` which
  fetches, resolves and signs against a `nostr-tools` pool (injectable for
  tests). RSVPs are signed through a `NostrSigner` from
  `@holons/core/holosphere` (`createIdentityContext` / `signerFromSecretKey`)
  — no raw private key crosses a module boundary.
- **`packages/telegram-ui/src/Shifts.js`** — rendering + Telegraf wiring only:
  `/shifts [today|tomorrow|week|YYYY-MM-DD]`, `/myshifts`, and the inline
  `✋ Take` / `❌ Drop` buttons; names via the users lens + 31926 lookup.
- **`packages/core/src/nostr/codecs/profile.ts`** — the `users`-lens codec:
  kind 0 (with the NIP-39 `i` claim) + NIP-29 membership + the 31926
  attestation companion the projection host signs as the identity provider.
- **`apps/kiosk/src/lib/views/ShiftsView.svelte`** — a Shifts tab on the
  kiosk: the next two weeks as day rows of shift notes with capacity meters
  and participant names, fed by `apps/kiosk/src/lib/shifts.ts` (periodic
  relay fetch). The tab
  appears by itself when the displayed holon has upcoming occurrences
  (tri-state caretaker pref, like Library/Roles). Relay + coordinator come
  from `VITE_KIOSK_SHIFT_RELAYS` / `VITE_KIOSK_SHIFT_COORDINATOR`, defaulting
  to `wss://relay.commonshub.dev` with any author trusted.
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

## Configuration (root `.env`)

```
SHIFTS_RELAYS=wss://relay.holons.io      # falls back to HOLOSPHERE_RELAYS
SHIFTS_COORDINATOR_PUBKEY=<hex>          # trust only this author's 31923s
NOSTR_DERIVATION_SECRET=<same as web>    # required for signups + attestations
SHIFTS_IDENTITY_BLACKLIST=               # optional: 31926 providers to ignore
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
  pubkeys the local `users` lens cannot explain through 31926 attestations
  (`fetchAttestations` + `attestationNameMap`). Precedence: local lens name →
  coordinator directory → other providers (newest wins) → `<8 hex>…`.
  `SHIFTS_IDENTITY_BLACKLIST` (comma-separated provider pubkeys) mutes
  misbehaving providers.

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

- Publishing Elinor-grammar occurrences (acting as coordinator) — Holons
  roles are day-granular and capacity-free; a `shifts` entity would be needed.
- Per-shift reminders and the pinned daily message.
- Calendar (ICS) feeds for shifts.
