// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// The `shifts` lens, carried on its standard kinds rather than on Holosphere's
// kind-30078 envelope.
//
// Elinor already publishes correct NIP-52 events for these holons, so there is
// nothing to ask of it: this decodes what is already on the relay into records
// at ordinary lens addresses, and `holosphere.getAll(holon, 'shifts')` answers
// from them like any other lens.
//
// READ-ONLY on the wire. Occurrences are the coordinator's to publish and a
// signup has a person-level rule (newest across a person's linked keys) that
// the generic per-address write path would get wrong, so `encode` is absent
// and Holosphere refuses a write to this lens. Signups keep going out through
// `buildRsvpTemplate` in ./protocol.
//
// Two lenses come out of one wire: an occurrence lands on `shifts`, and each
// signup lands on `shifts_rsvp` under its own address. Merging signups into
// the occurrence record on ingest would re-enter the write path, and with it
// the projection ratchet reverse sync exists to avoid.

import {
  SHIFT_HASHTAG,
  SHIFT_OCCURRENCE_KIND,
  SHIFT_RSVP_KIND,
  groupHashtag,
  parseShiftAddress,
  parseShiftDTag,
  parseShiftOccurrence,
  parseShiftRsvp,
  type NostrFilterLike,
  type ShiftIdentityMap,
} from './protocol.js';
import {
  IDENTITY_ATTESTATION_KIND,
  parseIdentityAttestation,
  type IdentityAttestation,
} from './attestation.js';
import type { NostrEventLike, ShiftOccurrence, ShiftRsvp } from './types.js';

/** The lens occurrences land on. */
export const SHIFTS_LENS = 'shifts';
/** NIP-09 retraction. */
const DELETE_KIND = 5;
/**
 * The identity directory, as a GLOBAL lens — an attestation is not scoped to a
 * holon, and the same one serves every board a person appears on.
 */
export const SHIFT_IDENTITY_LENS = 'shift_identity';
/** The lens signups land on, one record per person per occurrence. */
export const SHIFT_RSVP_LENS = 'shifts_rsvp';

/** Address of an occurrence within its holon: `<date>-<code>`. */
export function occurrenceId(date: string, code: string): string {
  return `${date}-${code}`;
}

/** Address of one person's signup: `<date>-<code>|<pubkey>`. */
export function rsvpId(date: string, code: string, pubkey: string): string {
  return `${occurrenceId(date, code)}|${pubkey}`;
}

export interface ShiftRecord {
  id: string;
  /** The holon this occurrence belongs to. */
  groupId: string;
  /** Full `d` tag, so the record maps back to the protocol shape exactly. */
  dTag: string;
  code: string;
  date: string;
  title: string;
  start: number;
  end: number;
  startTzid?: string;
  location?: string;
  capacity?: number;
  description: string;
  /** `31923:<coordinator>:<dTag>` — what a signup points at. */
  address: string;
  coordinator: string;
  createdAt: number;
  /** The occurrence event's own id. `id` has to be the store address. */
  eventId: string;
}

export interface ShiftRsvpRecord {
  id: string;
  occurrence: string;
  /** Full `d` tag of the signup event. */
  dTag: string;
  pubkey: string;
  status: 'accepted' | 'declined';
  address: string;
  /** Unix seconds — the newest signup per person is the one that counts. */
  createdAt: number;
  /** Who acted for this person, when someone did. */
  changedBy?: string;
  /**
   * A REQUEST published by an agent on someone's behalf, not occupancy.
   * Elinor marks these and excludes them; the real signup follows under the
   * member's own key. Counting them shows a phantom participant, attributed to
   * the agent rather than the person it names.
   */
  request?: true;
  /** The signup event's own id, which the resolution rule breaks ties on. */
  eventId: string;
}

type Claim = { holon: string; lens: string; id: string; item: Record<string, unknown> };

const tagged = (event: NostrEventLike, name: string, marker: string) =>
  event.tags.some((t: string[]) => t[0] === name && t[3] === marker);

/** Decode one occurrence or signup into the address it claims. */
export function decodeShiftEvent(event: NostrEventLike): Claim[] | null {
  if (event.kind === SHIFT_OCCURRENCE_KIND) {
    const occ = parseShiftOccurrence(event);
    if (!occ) return null;
    const item: ShiftRecord = {
      id: occurrenceId(occ.date, occ.code),
      groupId: occ.groupId,
      dTag: occ.dTag,
      code: occ.code,
      date: occ.date,
      title: occ.title,
      start: occ.start,
      end: occ.end,
      ...(occ.startTzid ? { startTzid: occ.startTzid } : {}),
      ...(occ.location ? { location: occ.location } : {}),
      ...(occ.capacity !== undefined ? { capacity: occ.capacity } : {}),
      description: occ.content,
      address: occ.address,
      coordinator: occ.pubkey,
      createdAt: occ.createdAt,
      eventId: occ.id,
    };
    return [{ holon: occ.groupId, lens: SHIFTS_LENS, id: item.id, item: item as never }];
  }

  if (event.kind === SHIFT_RSVP_KIND) {
    const rsvp = parseShiftRsvp(event);
    if (!rsvp) return null;
    // The `a` address names the occurrence and is authoritative. A signup's own
    // `d` tag follows whatever grammar its publisher chose — Elinor appends the
    // subject's key prefix to an on-behalf-of request, which the shift grammar
    // does not admit — so reading the address is both correct and more robust.
    const addr = parseShiftAddress(rsvp.address);
    const key = addr && parseShiftDTag(addr.dTag);
    if (!key) return null;
    const item: ShiftRsvpRecord = {
      id: rsvpId(key.date, key.code, rsvp.pubkey),
      occurrence: occurrenceId(key.date, key.code),
      dTag: rsvp.dTag,
      pubkey: rsvp.pubkey,
      status: rsvp.status,
      address: rsvp.address,
      createdAt: rsvp.createdAt,
      ...(rsvp.changedBy ? { changedBy: rsvp.changedBy } : {}),
      ...(tagged(event, 'p', 'on-behalf-of') ? { request: true as const } : {}),
      eventId: rsvp.id,
    };
    return [{ holon: key.groupId, lens: SHIFT_RSVP_LENS, id: item.id, item: item as never }];
  }

  return null;
}

export interface ShiftIdentityRecord {
  /** `<provider>|<identifier>` — the replaceable unit, one per provider. */
  id: string;
  provider: string;
  identifier: string;
  platform: string;
  platformId: string;
  pubkeys: string[];
  name?: string;
  createdAt: number;
  /** The attestation event's own id, which the resolvers break ties on. */
  eventId: string;
}

/** Address of one provider's claim about one identity. */
export function identityId(provider: string, identifier: string): string {
  return `${provider}|${identifier}`;
}

/** Decode a kind-31926 attestation into its global record. */
export function decodeAttestation(event: NostrEventLike): Claim[] | null {
  const a = parseIdentityAttestation(event);
  if (!a) return null;
  const item: ShiftIdentityRecord = {
    id: identityId(a.provider, a.identifier),
    provider: a.provider,
    identifier: a.identifier,
    platform: a.platform,
    platformId: a.platformId,
    pubkeys: a.pubkeys,
    ...(a.name ? { name: a.name } : {}),
    createdAt: a.createdAt,
    eventId: a.id,
  };
  // `holon: null` is the global holon: this directory belongs to no board.
  return [{ holon: null as never, lens: SHIFT_IDENTITY_LENS, id: item.id, item: item as never }];
}

/**
 * Records back into the shape `attestationNameMap` / `attestationIdentityMap`
 * expect. The record keeps the event id under `eventId` because `id` has to be
 * the store address, and the resolvers break ties on the event id.
 */
export function attestationsFrom(records: Iterable<ShiftIdentityRecord>): IdentityAttestation[] {
  const out: IdentityAttestation[] = [];
  for (const r of records) {
    if (!r || !r.provider || !r.identifier) continue;
    out.push({
      provider: r.provider,
      identifier: r.identifier,
      platform: r.platform,
      platformId: r.platformId,
      pubkeys: r.pubkeys ?? [],
      ...(r.name ? { name: r.name } : {}),
      createdAt: r.createdAt,
      id: r.eventId,
    });
  }
  return out;
}

/**
 * The identity wire.
 *
 * `providers` narrows the subscription by author. Left open it fetches every
 * attestation on the relay, which is what preserves today's behaviour: the
 * board honours any provider that names a participant, ranked with the
 * coordinator first. The direct relay client narrows by `#p` to the pubkeys
 * that turned up in the schedule, which a static lens filter cannot express —
 * so on a relay carrying a large directory, pin `providers`, accepting that
 * attestations from anyone else stop being seen.
 */
export function createShiftIdentityWire({ providers }: { providers?: string[] } = {}) {
  return {
    lens: SHIFT_IDENTITY_LENS,
    kinds: [IDENTITY_ATTESTATION_KIND],
    filters: () => [
      providers?.length
        ? { kinds: [IDENTITY_ATTESTATION_KIND], authors: providers }
        : { kinds: [IDENTITY_ATTESTATION_KIND] },
    ],
    decode: decodeAttestation,
  };
}

/**
 * The address a shift d tag names, for resolving a NIP-09 retraction.
 *
 * A kind 5 names its targets by `a` coordinate, so the registry has to turn
 * `shift-<group>-<date>-<code>` back into the record it stands for.
 */
export function shiftAddressOf(dTag: string): { holon: string; lens: string; id: string } | null {
  const key = parseShiftDTag(dTag);
  if (!key || key.kind !== 'shift') return null;
  return { holon: key.groupId, lens: SHIFTS_LENS, id: occurrenceId(key.date, key.code) };
}

/** The REQ shapes that keep a holon's schedule in sync. */
export function shiftFilters(holon: string, coordinatorPubkey?: string): NostrFilterLike[] {
  const occurrences: NostrFilterLike = {
    kinds: [SHIFT_OCCURRENCE_KIND],
    '#t': [groupHashtag(holon)],
  };
  if (coordinatorPubkey) occurrences.authors = [coordinatorPubkey];
  // Signups are filtered by the shift hashtag, not by occurrence address: a
  // live subscription cannot enumerate addresses it has not synced yet. Every
  // kind-31925 event on the relay carries it, checked against the live data.
  const out: NostrFilterLike[] = [occurrences, { kinds: [SHIFT_RSVP_KIND], '#t': [SHIFT_HASHTAG] }];
  // Retractions, narrowed to the coordinator. NIP-09 only lets an author
  // delete their own events, so this is both complete and safe. Without a
  // pinned coordinator there is no author to narrow to and subscribing to
  // every kind 5 on the relay would be absurd, so we take none.
  if (coordinatorPubkey) out.push({ kinds: [DELETE_KIND], authors: [coordinatorPubkey] });
  return out;
}

/**
 * Who may author what.
 *
 * A lens carried on a standard kind is permissionless BY KIND, which is far
 * wider than the envelope's permissionless-by-namespace: anyone can publish a
 * 31923 carrying a group tag. Occurrences are the coordinator's alone. A
 * signup is anyone's, and the signer is always its subject — a self-reported
 * id would let one member cancel another.
 */
export function authorizeShiftEvent(
  event: NostrEventLike,
  { coordinatorPubkey }: { coordinatorPubkey?: string } = {},
): boolean {
  if (event.kind === SHIFT_OCCURRENCE_KIND) {
    return !coordinatorPubkey || event.pubkey.toLowerCase() === coordinatorPubkey.toLowerCase();
  }
  return event.kind === SHIFT_RSVP_KIND;
}

/**
 * The wire to hand `createWireRegistry().register(...)`.
 *
 * `coordinatorPubkey` is worth setting in production. Without it any author's
 * occurrences are accepted, which is fine while developing against a relay you
 * control and is not fine on a shared one.
 */
export function createShiftWire({ coordinatorPubkey }: { coordinatorPubkey?: string } = {}) {
  return {
    lens: SHIFTS_LENS,
    kinds: [SHIFT_OCCURRENCE_KIND, SHIFT_RSVP_KIND],
    filters: (holon: string) => shiftFilters(holon, coordinatorPubkey),
    address: shiftAddressOf,
    decode: (event: NostrEventLike) =>
      (authorizeShiftEvent(event, { coordinatorPubkey }) ? decodeShiftEvent(event) : null),
  };
}

/**
 * A lens record back into the protocol shape.
 *
 * The two exist because a store record is addressed by `(holon, lens, id)`
 * while the protocol object is addressed by its Nostr coordinates. Every field
 * survives the round trip, so a caller that already speaks `ShiftOccurrence`
 * and `ShiftRsvp` — the bot, the board, `resolveRsvps` — needs no changes.
 */
export function toOccurrence(rec: ShiftRecord): ShiftOccurrence {
  return {
    dTag: rec.dTag,
    address: rec.address,
    pubkey: rec.coordinator,
    groupId: rec.groupId,
    date: rec.date,
    code: rec.code,
    title: rec.title,
    start: rec.start,
    end: rec.end,
    ...(rec.startTzid ? { startTzid: rec.startTzid } : {}),
    ...(rec.location ? { location: rec.location } : {}),
    ...(rec.capacity !== undefined ? { capacity: rec.capacity } : {}),
    content: rec.description,
    createdAt: rec.createdAt,
    id: rec.eventId,
  };
}

export function toRsvp(rec: ShiftRsvpRecord): ShiftRsvp {
  return {
    pubkey: rec.pubkey,
    address: rec.address,
    dTag: rec.dTag,
    status: rec.status,
    ...(rec.changedBy ? { changedBy: rec.changedBy } : {}),
    createdAt: rec.createdAt,
    id: rec.eventId,
  };
}

/**
 * The people holding an occurrence, from the signup records on `shifts_rsvp`.
 *
 * Newest wins per person, requests are not occupancy, and a `ShiftIdentityMap`
 * collapses one person's several keys so a cancel under one beats a signup
 * under another. Returns the PUBKEY of each holder's winning signup, not the
 * collapsed person id: a name map is keyed by pubkey, so returning the person
 * id would leave every caller unable to look up who they are.
 */
export function participantsOf(
  occurrence: string,
  rsvps: Iterable<ShiftRsvpRecord>,
  identity?: ShiftIdentityMap,
): string[] {
  const person = (pk: string) => identity?.get(pk) ?? pk;
  const latest = new Map<string, ShiftRsvpRecord>();
  for (const r of rsvps) {
    if (r.occurrence !== occurrence || r.request) continue;
    const who = person(r.pubkey);
    const prev = latest.get(who);
    // Newest per PERSON, not per key, and ties break on the smaller event id
    // the same way the protocol's own resolution does.
    if (!prev || r.createdAt > prev.createdAt || (r.createdAt === prev.createdAt && r.id < prev.id)) {
      latest.set(who, r);
    }
  }
  return [...latest.values()].filter((r) => r.status === 'accepted').map((r) => r.pubkey);
}
