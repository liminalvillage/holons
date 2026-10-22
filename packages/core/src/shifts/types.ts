// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Types for the Elinor shift-coordination format (NIP-52 flavoured
// addressable events, see https://elinor.commonshub.dev/docs).

/** A shift occurrence — one kind-31923 event per group/day/code. */
export interface ShiftOccurrence {
  /** Full `d` tag: `shift-<groupId>-<YYYY-MM-DD>-<code>`. */
  dTag: string;
  /** Addressable reference `31923:<pubkey>:<dTag>` used by RSVPs' `a` tag. */
  address: string;
  /** Coordinator pubkey that published the occurrence. */
  pubkey: string;
  /** Group id — in practice the Telegram chat id, i.e. the holon id. */
  groupId: string;
  /** `YYYY-MM-DD` of the occurrence. */
  date: string;
  /** Short shift code (`mc`, `lp`, `dp`, …). */
  code: string;
  title: string;
  /** Unix seconds. */
  start: number;
  /** Unix seconds. */
  end: number;
  /** IANA zone for display. */
  startTzid?: string;
  location?: string;
  /** Max accepted participants; `undefined` when the tag is missing. */
  capacity?: number;
  /** Free-text description from `content`. */
  content: string;
  createdAt: number;
  id: string;
}

export type ShiftRsvpStatus = 'accepted' | 'declined';

/** A signup — one kind-31925 event per (participant, occurrence). */
export interface ShiftRsvp {
  /** Participant pubkey (the event author). */
  pubkey: string;
  /** Occurrence address this RSVP refers to (`a` tag). */
  address: string;
  dTag: string;
  status: ShiftRsvpStatus;
  /** Pubkey that made the change on the participant's behalf, if any. */
  changedBy?: string;
  createdAt: number;
  id: string;
}

/** Minimal NIP-01 event shape accepted by the parsers (signed or not). */
export interface NostrEventLike {
  id?: string;
  pubkey: string;
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
  sig?: string;
}

// ---------------------------------------------------------------------------
// The shift PLAN — what a holon expects to run, from which its coordinator
// materialises kind-31923 occurrences. Mirrors Elinor's per-group catalog
// (code/title/start/end/capacity/enabled/description) so a plan edited here
// and one edited in Elinor describe the same thing; `days` and `location` are
// Holons extensions Elinor simply never sets (every day, one location).
// ---------------------------------------------------------------------------

/** One recurring shift in a holon's catalog. */
export interface ShiftDefinition {
  /** `[a-z0-9]{1,16}` — the last segment of every occurrence's `d` tag. */
  code: string;
  title: string;
  /** Wall-clock `HH:MM` in the plan's zone. */
  start: string;
  /** Wall-clock `HH:MM` in the plan's zone; must be after `start`. */
  end: string;
  /** People needed. Elinor's catalog defaults to 2. */
  capacity: number;
  /** A disabled shift stays in the catalog (history renders) but is not materialised. */
  enabled: boolean;
  description?: string;
  /**
   * ISO weekdays the shift runs on (1 = Monday … 7 = Sunday). Absent or
   * empty means every day, which is what Elinor does.
   */
  days?: number[];
  /** Overrides the plan's location for this shift. */
  location?: string;
}

/** A holon's shift plan, kept on its `settings` record under `shifts`. */
export interface ShiftPlan {
  /** IANA zone the wall-clock times are in. */
  tzid: string;
  location?: string;
  /** How many days ahead occurrences are materialised (Elinor: 14). */
  horizonDays: number;
  shifts: ShiftDefinition[];
}
