// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Elinor identity attestations (kind 31926) — pure rules. No network, no keys.
//
//   kind 31926  identity attestation   d = telegram:<telegram_user_id>
//                                      p = every key currently linked to that
//                                          user (one tag per key)
//                                      content = {"name":"<display name>"}
//
// Addressable: republishing the same `d` REPLACES the provider's previous
// list, so an attestation must always carry the user's COMPLETE key set —
// omitting a `p` unlinks that key. Any app may act as a provider (no
// registration); Elinor honors attestations by default and its coordinator
// publishes the same directory for every member it manages, which makes
// `{kinds:[31926], authors:[coordinator]}` the authoritative Telegram↔npub
// mapping. Governance is a community blacklist of misbehaving providers.

import type { NostrEventLike } from './types.js';
import type { NostrFilterLike } from './protocol.js';

export const IDENTITY_ATTESTATION_KIND = 31926;

/** A parsed kind-31926 event. */
export interface IdentityAttestation {
  /** Provider pubkey (the event author). */
  provider: string;
  /** Full `d` tag, e.g. `telegram:123456`. */
  identifier: string;
  /** Platform half of the identifier (`telegram`). */
  platform: string;
  /** Platform-side user id (`123456`). */
  platformId: string;
  /** Every linked pubkey — lowercased hex, deduped, sorted. */
  pubkeys: string[];
  /** Display name from the content JSON, when present. */
  name?: string;
  createdAt: number;
  id: string;
}

/**
 * The NIP-39 / kind-31926 identifier for a Telegram user. Single source of
 * the grammar — the same string is the `d` tag here, the `i` tag on kind-0
 * profiles, and the HMAC message of the member-key derivation.
 */
export function telegramIdentifier(telegramId: string | number): string {
  return `telegram:${telegramId}`;
}

/** Split `<platform>:<id>`; `null` when either half is empty. */
export function parseIdentifier(d: string): { platform: string; id: string } | null {
  const i = d.indexOf(':');
  if (i <= 0 || i === d.length - 1) return null;
  return { platform: d.slice(0, i), id: d.slice(i + 1) };
}

const HEX64 = /^[0-9a-f]{64}$/i;

/** Parse a kind-31926 event. Returns `null` when it is not a valid attestation. */
export function parseIdentityAttestation(event: NostrEventLike): IdentityAttestation | null {
  if (event.kind !== IDENTITY_ATTESTATION_KIND) return null;
  const identifier = event.tags.find((t) => t[0] === 'd')?.[1];
  if (!identifier) return null;
  const parsed = parseIdentifier(identifier);
  if (!parsed) return null;
  const pubkeys = [
    ...new Set(
      event.tags
        .filter((t) => t[0] === 'p' && typeof t[1] === 'string' && HEX64.test(t[1]))
        .map((t) => t[1].toLowerCase()),
    ),
  ].sort();
  let name: string | undefined;
  try {
    const meta = JSON.parse(event.content || '{}');
    if (meta && typeof meta.name === 'string' && meta.name.trim()) name = meta.name.trim();
  } catch {
    return null;
  }
  return {
    provider: event.pubkey,
    identifier,
    platform: parsed.platform,
    platformId: parsed.id,
    pubkeys,
    name,
    createdAt: event.created_at,
    id: event.id ?? '',
  };
}

export interface AttestationTemplate {
  kind: typeof IDENTITY_ATTESTATION_KIND;
  created_at: number;
  tags: string[][];
  content: string;
}

export interface BuildAttestationOptions {
  telegramId: string | number;
  /**
   * The user's COMPLETE current key set. Replaceable semantics: this list
   * overwrites the provider's previous attestation for the same user, and a
   * key left out here is thereby unlinked.
   */
  pubkeys: string[];
  name?: string;
  now?: number;
}

/** Build the unsigned kind-31926 template in the spec's exact shape. */
export function buildAttestationTemplate(opts: BuildAttestationOptions): AttestationTemplate {
  const pubkeys = [...new Set(opts.pubkeys.map((pk) => pk.toLowerCase()))].sort();
  if (!pubkeys.length || pubkeys.some((pk) => !HEX64.test(pk))) {
    throw new Error('buildAttestationTemplate: pubkeys must be non-empty 64-char hex');
  }
  const name = opts.name?.trim();
  return {
    kind: IDENTITY_ATTESTATION_KIND,
    created_at: opts.now ?? Math.floor(Date.now() / 1000),
    tags: [['d', telegramIdentifier(opts.telegramId)], ...pubkeys.map((pk) => ['p', pk])],
    content: JSON.stringify(name ? { name } : {}),
  };
}

/**
 * Collapse raw attestations to the winning one per (provider, identifier) —
 * newest `created_at`; ties break to the lexically smallest `id` (same rule
 * as RSVPs). Input order is irrelevant.
 */
export function resolveAttestations(atts: Iterable<IdentityAttestation>): Map<string, IdentityAttestation> {
  const winners = new Map<string, IdentityAttestation>();
  for (const a of atts) {
    const k = `${a.provider} ${a.identifier}`;
    const prev = winners.get(k);
    if (!prev || a.createdAt > prev.createdAt || (a.createdAt === prev.createdAt && a.id < prev.id)) {
      winners.set(k, a);
    }
  }
  return winners;
}

export interface AttestationNameMapOptions {
  /** Elinor's coordinator — its directory outranks every other provider. */
  coordinatorPubkey?: string;
  /** Blacklisted providers whose attestations are ignored entirely. */
  blockedProviders?: Iterable<string>;
}

/**
 * pubkey → display name from a set of attestations. Per pubkey the
 * coordinator's attestation wins over any other provider's; within the same
 * rank the newest `created_at` wins. Attestations without a name never
 * displace one that has a name.
 */
export function attestationNameMap(
  atts: Iterable<IdentityAttestation>,
  opts: AttestationNameMapOptions = {},
): Map<string, string> {
  const coordinator = opts.coordinatorPubkey?.toLowerCase();
  const blocked = new Set([...(opts.blockedProviders ?? [])].map((p) => p.toLowerCase()));
  const best = new Map<string, { rank: number; createdAt: number; name: string }>();
  for (const a of resolveAttestations(atts).values()) {
    if (!a.name || blocked.has(a.provider.toLowerCase())) continue;
    const rank = coordinator && a.provider.toLowerCase() === coordinator ? 1 : 0;
    for (const pk of a.pubkeys) {
      const cur = best.get(pk);
      if (!cur || rank > cur.rank || (rank === cur.rank && a.createdAt > cur.createdAt)) {
        best.set(pk, { rank, createdAt: a.createdAt, name: a.name });
      }
    }
  }
  return new Map([...best].map(([pk, v]) => [pk, v.name]));
}

/**
 * pubkey → person identifier (`telegram:<id>`) — the collapse map for
 * person-level RSVP resolution: Elinor's canonical rule is that a person's
 * status on a shift is decided by the newest RSVP across ALL of their linked
 * keys, so every consumer that resolves RSVPs needs this map.
 *
 * Guardrails (mirroring Elinor's write-side enforcement, applied here on the
 * read side since arbitrary providers publish 31926s):
 *  - the coordinator's own key is never claimable as a person key;
 *  - a key already linked to one person is never remapped to another — the
 *    coordinator's directory outranks other providers, then the EARLIEST
 *    link wins (ties to the smallest event id);
 *  - blacklisted providers are ignored entirely.
 */
export function attestationIdentityMap(
  atts: Iterable<IdentityAttestation>,
  opts: AttestationNameMapOptions = {},
): Map<string, string> {
  const coordinator = opts.coordinatorPubkey?.toLowerCase();
  const blocked = new Set([...(opts.blockedProviders ?? [])].map((p) => p.toLowerCase()));
  const ranked = [...resolveAttestations(atts).values()]
    .filter((a) => !blocked.has(a.provider.toLowerCase()))
    .sort((a, b) => {
      const rank = (x: IdentityAttestation) => (coordinator && x.provider.toLowerCase() === coordinator ? 1 : 0);
      return rank(b) - rank(a) || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1);
    });
  const identity = new Map<string, string>();
  for (const a of ranked) {
    for (const pk of a.pubkeys) {
      if (pk === coordinator) continue;
      if (!identity.has(pk)) identity.set(pk, a.identifier);
    }
  }
  return identity;
}

// ---------------------------------------------------------------------------
// Filters (NIP-01 REQ shapes)
// ---------------------------------------------------------------------------

export interface AttestationFilterOptions {
  authors?: string[];
  /** Pubkeys the attestations must link (`#p`). */
  participants?: string[];
  /** Full identifiers (`#d`), e.g. `telegram:123`. */
  identifiers?: string[];
  limit?: number;
}

/** Filter for kind-31926 attestations. At least one constraint is required. */
export function attestationFilter(opts: AttestationFilterOptions): NostrFilterLike {
  if (!opts.authors?.length && !opts.participants?.length && !opts.identifiers?.length) {
    throw new Error('attestationFilter: authors, participants or identifiers required');
  }
  const f: NostrFilterLike = { kinds: [IDENTITY_ATTESTATION_KIND] };
  if (opts.authors?.length) f.authors = opts.authors;
  if (opts.participants?.length) f['#p'] = opts.participants;
  if (opts.identifiers?.length) f['#d'] = opts.identifiers;
  if (opts.limit !== undefined) f.limit = opts.limit;
  return f;
}

/** The authoritative Telegram↔npub directory: everything the coordinator attests. */
export function coordinatorDirectoryFilter(coordinatorPubkey: string): NostrFilterLike {
  return { kinds: [IDENTITY_ATTESTATION_KIND], authors: [coordinatorPubkey] };
}
