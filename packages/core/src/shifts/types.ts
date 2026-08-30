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
