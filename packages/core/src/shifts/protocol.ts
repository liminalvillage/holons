// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Elinor shift protocol — pure rules. No network, no signing key handling.
//
//   kind 31923  shift occurrence   d = shift-<groupId>-<date>-<code>
//   kind 31925  signup (RSVP)      d = rsvp-<groupId>-<date>-<code>
//                                  a = 31923:<coordinator>:<occurrence d>
//
// Resolution: for each (author, a) the RSVP with the highest `created_at`
// wins; ties break to the lexically smallest `id`. One person may act
// through several keys (bridged by kind-31926 attestations), and the
// canonical status of a person is the newest RSVP across ALL of their keys —
// pass a `ShiftIdentityMap` to resolve per person instead of per key.
// Capacity is cooperative — the relay does not enforce it, so callers check
// `hasCapacity` before publishing.

import type { NostrEventLike, ShiftOccurrence, ShiftRsvp, ShiftRsvpStatus } from './types.js';

export const SHIFT_OCCURRENCE_KIND = 31923;
export const SHIFT_RSVP_KIND = 31925;
export const SHIFT_HASHTAG = 'shift';

/** Elinor's default shift codes → titles (informational; relay data wins). */
export const DEFAULT_SHIFT_CODES: Readonly<Record<string, string>> = {
  mc: 'Morning Cleaning',
  lp: 'Lunch Preparation',
  lc: 'Lunch Cleaning',
  dp: 'Dinner Preparation',
  dc: 'Dinner Cleaning',
};

// Group ids are Telegram chat ids, so they may be negative — the leading `-`
// is part of the id and must not be swallowed by the separator.
const D_TAG_RE = /^(shift|rsvp)-(-?\d+|[A-Za-z0-9_]+)-(\d{4}-\d{2}-\d{2})-([a-z0-9]{1,16})$/;

export interface ShiftKey {
  groupId: string;
  date: string;
  code: string;
}

export function shiftDTag({ groupId, date, code }: ShiftKey): string {
  return `shift-${groupId}-${date}-${code}`;
}

export function rsvpDTag({ groupId, date, code }: ShiftKey): string {
  return `rsvp-${groupId}-${date}-${code}`;
}

export function shiftAddress(coordinatorPubkey: string, dTag: string): string {
  return `${SHIFT_OCCURRENCE_KIND}:${coordinatorPubkey}:${dTag}`;
}

export function groupHashtag(groupId: string): string {
  return `group-${groupId}`;
}

/** Parse either a `shift-…` or `rsvp-…` d tag. Returns `null` if malformed. */
export function parseShiftDTag(dTag: string): (ShiftKey & { kind: 'shift' | 'rsvp' }) | null {
  const m = D_TAG_RE.exec(dTag);
  if (!m) return null;
  return { kind: m[1] as 'shift' | 'rsvp', groupId: m[2], date: m[3], code: m[4] };
}

/** Split `31923:<pubkey>:<dTag>` into its parts. */
export function parseShiftAddress(address: string): { kind: number; pubkey: string; dTag: string } | null {
  const i = address.indexOf(':');
  const j = address.indexOf(':', i + 1);
  if (i < 0 || j < 0) return null;
  const kind = Number(address.slice(0, i));
  if (!Number.isInteger(kind)) return null;
  return { kind, pubkey: address.slice(i + 1, j), dTag: address.slice(j + 1) };
}

function tagValue(event: NostrEventLike, name: string): string | undefined {
  return event.tags.find((t) => t[0] === name)?.[1];
}

function tagValues(event: NostrEventLike, name: string): string[] {
  return event.tags.filter((t) => t[0] === name).map((t) => t[1]);
}

/** Parse a kind-31923 event. Returns `null` when it is not a valid occurrence. */
export function parseShiftOccurrence(event: NostrEventLike): ShiftOccurrence | null {
  if (event.kind !== SHIFT_OCCURRENCE_KIND) return null;
  const dTag = tagValue(event, 'd');
  if (!dTag) return null;
  const key = parseShiftDTag(dTag);
  if (!key || key.kind !== 'shift') return null;
  const start = Number(tagValue(event, 'start'));
  const end = Number(tagValue(event, 'end'));
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const capRaw = tagValue(event, 'capacity');
  const capacity = capRaw === undefined ? undefined : Number(capRaw);
  return {
    dTag,
    address: shiftAddress(event.pubkey, dTag),
    pubkey: event.pubkey,
    groupId: key.groupId,
    date: key.date,
    code: key.code,
    title: tagValue(event, 'title') ?? DEFAULT_SHIFT_CODES[key.code] ?? key.code,
    start,
    end,
    startTzid: tagValue(event, 'start_tzid'),
    location: tagValue(event, 'location'),
    capacity: capacity !== undefined && Number.isInteger(capacity) && capacity >= 0 ? capacity : undefined,
    content: event.content ?? '',
    createdAt: event.created_at,
    id: event.id ?? '',
  };
}

/** Parse a kind-31925 event. Returns `null` when it is not a valid signup. */
export function parseShiftRsvp(event: NostrEventLike): ShiftRsvp | null {
  if (event.kind !== SHIFT_RSVP_KIND) return null;
  const address = tagValue(event, 'a');
  const dTag = tagValue(event, 'd');
  const status = tagValue(event, 'status');
  if (!address || !dTag || (status !== 'accepted' && status !== 'declined')) return null;
  const changedBy = event.tags.find((t) => t[0] === 'p' && t[3] === 'changed-by')?.[1];
  return {
    pubkey: event.pubkey,
    address,
    dTag,
    status,
    changedBy,
    createdAt: event.created_at,
    id: event.id ?? '',
  };
}

/** True when `later` should replace `prev` under the resolution rule. */
export function rsvpSupersedes(later: ShiftRsvp, prev: ShiftRsvp | undefined): boolean {
  if (!prev) return true;
  if (later.createdAt !== prev.createdAt) return later.createdAt > prev.createdAt;
  return later.id < prev.id;
}

/**
 * pubkey → person identifier (`telegram:<id>`), from kind-31926 attestations
 * — see `attestationIdentityMap`. One person may act through several keys
 * (the Elinor coordinator-derived key plus any linked app keys), and their
 * canonical status on a shift is the newest RSVP across all of them, so
 * every resolver below accepts this map. A key the map does not know keeps
 * resolving on its own.
 */
export type ShiftIdentityMap = Pick<Map<string, string>, 'get'>;

function personOf(pubkey: string, identity?: ShiftIdentityMap): string {
  return identity?.get(pubkey.toLowerCase()) ?? pubkey;
}

/**
 * Collapse raw RSVPs to the winning one per (person, address) — per (author,
 * address) when no identity map is given. Input order is irrelevant.
 */
export function resolveRsvps(rsvps: Iterable<ShiftRsvp>, identity?: ShiftIdentityMap): Map<string, ShiftRsvp> {
  const winners = new Map<string, ShiftRsvp>();
  for (const r of rsvps) {
    const k = `${personOf(r.pubkey, identity)}\0${r.address}`;
    if (rsvpSupersedes(r, winners.get(k))) winners.set(k, r);
  }
  return winners;
}

/**
 * Pubkeys currently enrolled (latest RSVP is `accepted`) for one occurrence
 * — with an identity map, one pubkey per person (whichever of their keys
 * signed the winning RSVP).
 */
export function enrolledPubkeys(
  occurrence: Pick<ShiftOccurrence, 'address'>,
  rsvps: Iterable<ShiftRsvp>,
  identity?: ShiftIdentityMap,
): string[] {
  const out: string[] = [];
  for (const r of resolveRsvps(rsvps, identity).values()) {
    if (r.address === occurrence.address && r.status === 'accepted') out.push(r.pubkey);
  }
  return out.sort();
}

/** Latest RSVP a participant — with an identity map, their person — has for an occurrence. */
export function latestRsvpFor(
  occurrence: Pick<ShiftOccurrence, 'address'>,
  pubkey: string,
  rsvps: Iterable<ShiftRsvp>,
  identity?: ShiftIdentityMap,
): ShiftRsvp | undefined {
  return resolveRsvps(rsvps, identity).get(`${personOf(pubkey, identity)}\0${occurrence.address}`);
}

export function isEnrolled(
  occurrence: Pick<ShiftOccurrence, 'address'>,
  pubkey: string,
  rsvps: Iterable<ShiftRsvp>,
  identity?: ShiftIdentityMap,
): boolean {
  return latestRsvpFor(occurrence, pubkey, rsvps, identity)?.status === 'accepted';
}

/** Cooperative capacity check; unlimited when the occurrence has no capacity. */
export function hasCapacity(
  occurrence: Pick<ShiftOccurrence, 'address' | 'capacity'>,
  rsvps: Iterable<ShiftRsvp>,
  identity?: ShiftIdentityMap,
): boolean {
  if (occurrence.capacity === undefined) return true;
  return enrolledPubkeys(occurrence, rsvps, identity).length < occurrence.capacity;
}

export interface RsvpTemplate {
  kind: typeof SHIFT_RSVP_KIND;
  created_at: number;
  tags: string[][];
  content: '';
}

export interface BuildRsvpOptions {
  occurrence: Pick<ShiftOccurrence, 'address' | 'dTag' | 'groupId' | 'date' | 'code'>;
  status: ShiftRsvpStatus;
  /** Pubkey acting on the participant's behalf (adds `p … changed-by`). */
  actorPubkey?: string;
  /** Participant's previous RSVP for this occurrence — `created_at` must strictly exceed it. */
  previous?: Pick<ShiftRsvp, 'createdAt'>;
  now?: number;
}

/**
 * Build the unsigned kind-31925 template. The relay rejects an RSVP whose
 * `created_at` does not strictly exceed the participant's previous one for
 * the same `d`, so pass `previous` when known — and let it be the PERSON's
 * newest RSVP across all linked keys, or the event loses the person-level
 * comparison to a sibling key's signup.
 */
export function buildRsvpTemplate(opts: BuildRsvpOptions): RsvpTemplate {
  const { occurrence, status, actorPubkey, previous } = opts;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const created_at = previous ? Math.max(now, previous.createdAt + 1) : now;
  const tags: string[][] = [
    ['a', occurrence.address],
    ['d', rsvpDTag(occurrence)],
    ['status', status],
    ['t', SHIFT_HASHTAG],
  ];
  if (actorPubkey) tags.push(['p', actorPubkey, '', 'changed-by']);
  return { kind: SHIFT_RSVP_KIND, created_at, tags, content: '' };
}

// ---------------------------------------------------------------------------
// Occurrence templates — the coordinator's side of the wire
// ---------------------------------------------------------------------------

/** NIP-09 retraction. */
export const SHIFT_DELETE_KIND = 5;

/** `[a-z0-9]{1,16}` — what the d-tag grammar admits as a code. */
export function isValidShiftCode(code: string): boolean {
  return /^[a-z0-9]{1,16}$/.test(code ?? '');
}

export interface OccurrenceTemplate {
  kind: typeof SHIFT_OCCURRENCE_KIND;
  created_at: number;
  tags: string[][];
  content: string;
}

export interface BuildOccurrenceOptions extends ShiftKey {
  title: string;
  /** Unix seconds. */
  start: number;
  /** Unix seconds; must exceed `start`. */
  end: number;
  /** IANA zone the shift is displayed in. */
  tzid?: string;
  location?: string;
  capacity?: number;
  /** Free text; when absent the content is derived Elinor-style from title/time/place. */
  description?: string;
  /** Wall-clock `HH:MM–HH:MM` for the derived content (display only). */
  timeRange?: string;
  now?: number;
}

/**
 * Build the unsigned kind-31923 occurrence exactly as Elinor publishes it
 * (`d`, `title`, `start`, `end`, `start_tzid`, `location`, `capacity`,
 * `t:shift`, `t:<code>`, `t:group-<groupId>`), so an Elinor client reads a
 * Holons-published shift as one of its own. Addressable: republishing the
 * same key REPLACES the occurrence — that is how an edit goes out.
 */
export function buildOccurrenceTemplate(opts: BuildOccurrenceOptions): OccurrenceTemplate {
  const { groupId, date, code } = opts;
  if (!isValidShiftCode(code)) throw new Error(`buildOccurrenceTemplate: invalid shift code "${code}"`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`buildOccurrenceTemplate: invalid date "${date}"`);
  if (!Number.isFinite(opts.start) || !Number.isFinite(opts.end) || opts.end <= opts.start) {
    throw new Error('buildOccurrenceTemplate: end must be after start');
  }
  const title = opts.title.trim() || DEFAULT_SHIFT_CODES[code] || code;
  const tags: string[][] = [
    ['d', shiftDTag({ groupId, date, code })],
    ['title', title],
    ['start', String(Math.floor(opts.start))],
    ['end', String(Math.floor(opts.end))],
  ];
  if (opts.tzid) tags.push(['start_tzid', opts.tzid]);
  if (opts.location) tags.push(['location', opts.location]);
  if (opts.capacity !== undefined && Number.isInteger(opts.capacity) && opts.capacity >= 0) {
    tags.push(['capacity', String(opts.capacity)]);
  }
  tags.push(['t', SHIFT_HASHTAG], ['t', code], ['t', groupHashtag(groupId)]);
  const range = opts.timeRange ?? `${formatShiftTime(opts.start, opts.tzid)}–${formatShiftTime(opts.end, opts.tzid)}`;
  const place = opts.location ? ` (${opts.location})` : '';
  const desc = opts.description?.trim();
  const content = desc ? `${title} shift, ${range}${place} — ${desc}` : `${title} shift, ${range}${place}`;
  return {
    kind: SHIFT_OCCURRENCE_KIND,
    created_at: opts.now ?? Math.floor(Date.now() / 1000),
    tags,
    content,
  };
}

export interface DeleteTemplate {
  kind: typeof SHIFT_DELETE_KIND;
  created_at: number;
  tags: string[][];
  content: string;
}

/**
 * Build the unsigned NIP-09 retraction for one or more occurrences. Names
 * each by its `a` coordinate (what the lens wire resolves to a tombstone)
 * and by event id when known, plus `k` 31923 so a relay can serve
 * "deletions of shifts" without a pinned author. Only the coordinator that
 * published an occurrence can retract it — NIP-09 ignores anyone else.
 */
export function buildOccurrenceDeleteTemplate(
  occurrences: Array<Pick<ShiftOccurrence, 'address'> & Partial<Pick<ShiftOccurrence, 'id'>>>,
  opts: { reason?: string; now?: number } = {},
): DeleteTemplate {
  if (!occurrences.length) throw new Error('buildOccurrenceDeleteTemplate: nothing to retract');
  const tags: string[][] = [];
  for (const o of occurrences) {
    tags.push(['a', o.address]);
    if (o.id) tags.push(['e', o.id]);
  }
  tags.push(['k', String(SHIFT_OCCURRENCE_KIND)]);
  return {
    kind: SHIFT_DELETE_KIND,
    created_at: opts.now ?? Math.floor(Date.now() / 1000),
    tags,
    content: opts.reason ?? '',
  };
}

// ---------------------------------------------------------------------------
// Filters (NIP-01 REQ shapes)
// ---------------------------------------------------------------------------

export interface NostrFilterLike {
  kinds?: number[];
  authors?: string[];
  since?: number;
  until?: number;
  limit?: number;
  [tag: `#${string}`]: string[] | undefined;
}

export interface OccurrenceFilterOptions {
  groupId: string;
  /** Restrict to the coordinator's pubkey — recommended; anyone can publish 31923. */
  coordinatorPubkey?: string;
  since?: number;
  until?: number;
  limit?: number;
}

/** Filter for all occurrences in a group. */
export function occurrenceFilter(opts: OccurrenceFilterOptions): NostrFilterLike {
  const f: NostrFilterLike = { kinds: [SHIFT_OCCURRENCE_KIND], '#t': [groupHashtag(opts.groupId)] };
  if (opts.coordinatorPubkey) f.authors = [opts.coordinatorPubkey];
  if (opts.since !== undefined) f.since = opts.since;
  if (opts.until !== undefined) f.until = opts.until;
  if (opts.limit !== undefined) f.limit = opts.limit;
  return f;
}

/** Filter for all RSVPs referencing the given occurrence addresses. */
export function rsvpFilter(addresses: string[]): NostrFilterLike {
  return { kinds: [SHIFT_RSVP_KIND], '#a': addresses };
}

/** Filter for one participant's RSVPs. */
export function participantRsvpFilter(pubkey: string): NostrFilterLike {
  return { kinds: [SHIFT_RSVP_KIND], authors: [pubkey], '#t': [SHIFT_HASHTAG] };
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** `HH:MM` in the occurrence's zone (falls back to UTC). */
export function formatShiftTime(unixSeconds: number, tzid?: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: tzid || 'UTC',
    }).format(new Date(unixSeconds * 1000));
  } catch {
    return new Date(unixSeconds * 1000).toISOString().slice(11, 16);
  }
}

/** Sort occurrences by start, then code. */
export function sortOccurrences(list: ShiftOccurrence[]): ShiftOccurrence[] {
  return [...list].sort((a, b) => a.start - b.start || a.code.localeCompare(b.code));
}
