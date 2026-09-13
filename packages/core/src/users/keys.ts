// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// A member's several Nostr keys, tied together by kind-31926 attestations.
//
// A Telegram member always has ONE derived key (the service derives it from
// their Telegram id — see `@holons/core/auth`). They may also hold keys of
// their own: a Nostr client, a passkey, a wallet. Linking such a key makes
// the identity provider's kind-31926 attestation for `telegram:<id>` list
// it beside the derived key, so every consumer that collapses RSVPs and
// names per PERSON (`attestationIdentityMap`) counts the two as one.
//
// The link list lives on the member's `users` record in their PERSONAL holon
// (holon id = the Telegram id) — one source of truth — and is mirrored onto
// any other holon record the caller names, so a re-projection from a group
// holon never silently shrinks the attested set (an omitted key is an
// UNLINKED key; see `buildAttestationTemplate`).
//
// Proof of control before a link: the member posts a short challenge from
// the key they claim (any Nostr client can post a note) and the caller
// checks the relays for it — `buildKeyLinkChallenge` / `verifyKeyLinkProof`.
// Without proof anyone could annex a stranger's key to their own person.

import * as nip19 from 'nostr-tools/nip19';
import { getUserProfile, saveUserProfile } from './profile.js';
import type { TelegramUserLike, UserDB, UserProfile } from './index.js';

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * A hex or npub public key → lowercase 64-hex, or null when it is neither.
 * Whitespace and a `nostr:` prefix are tolerated (people paste both).
 */
export function normalizePubkey(input: string | null | undefined): string | null {
  const raw = String(input ?? '').trim().replace(/^nostr:/i, '');
  if (!raw) return null;
  if (HEX64.test(raw.toLowerCase())) return raw.toLowerCase();
  if (/^npub1[02-9ac-hj-np-z]+$/i.test(raw)) {
    try {
      const decoded = nip19.decode(raw.toLowerCase());
      if (decoded.type === 'npub') return decoded.data;
    } catch {
      /* not a valid npub */
    }
  }
  return null;
}

/** The keys a profile links beyond its derived one — always normalised, deduped, sorted. */
export function linkedKeysOf(profile: Pick<UserProfile, 'linkedKeys'> | null | undefined): string[] {
  const raw = Array.isArray(profile?.linkedKeys) ? profile!.linkedKeys : [];
  const keys = raw.map((k) => normalizePubkey(String(k))).filter((k): k is string => !!k);
  return [...new Set(keys)].sort();
}

/** The holon that holds a member's canonical profile: their personal holon. */
export function personalHolonOf(user: Pick<TelegramUserLike, 'id'>): string {
  return String(user.id);
}

export interface LinkKeyOptions {
  /**
   * Other holons whose `users` record should mirror the new list (the caller
   * names the ones it knows the member is in). The personal holon is always
   * written.
   */
  holons?: Array<string | number>;
}

async function writeLinkedKeys(
  db: UserDB,
  user: TelegramUserLike,
  keys: string[],
  opts: LinkKeyOptions,
): Promise<string[]> {
  const targets = [personalHolonOf(user), ...(opts.holons ?? []).map(String)];
  for (const holon of [...new Set(targets)]) {
    const profile = await getUserProfile(db, user, holon);
    if (!profile) continue;
    const next: UserProfile = { ...profile };
    if (keys.length) next.linkedKeys = keys;
    else delete next.linkedKeys;
    await saveUserProfile(db, holon, next);
  }
  return keys;
}

/** The member's current linked keys, read from their personal holon. */
export async function getLinkedKeys(db: UserDB, user: TelegramUserLike): Promise<string[]> {
  const profile = await getUserProfile(db, user, personalHolonOf(user));
  return linkedKeysOf(profile);
}

/**
 * Link a key (hex or npub) to the member. Idempotent. Returns the resulting
 * list, or throws on an unparsable key. Callers verify control first
 * ({@link verifyKeyLinkProof}); this function only records the decision.
 */
export async function linkUserKey(
  db: UserDB,
  user: TelegramUserLike,
  pubkey: string,
  opts: LinkKeyOptions = {},
): Promise<string[]> {
  const pk = normalizePubkey(pubkey);
  if (!pk) throw new Error('linkUserKey: expected a 64-char hex pubkey or an npub');
  const current = await getLinkedKeys(db, user);
  if (current.includes(pk)) return writeLinkedKeys(db, user, current, opts);
  return writeLinkedKeys(db, user, [...current, pk].sort(), opts);
}

/** Unlink a key. Returns the resulting list; unknown keys are a no-op. */
export async function unlinkUserKey(
  db: UserDB,
  user: TelegramUserLike,
  pubkey: string,
  opts: LinkKeyOptions = {},
): Promise<string[]> {
  const pk = normalizePubkey(pubkey);
  const current = await getLinkedKeys(db, user);
  const next = pk ? current.filter((k) => k !== pk) : current;
  return writeLinkedKeys(db, user, next, opts);
}

// ── Proof of control ───────────────────────────────────────────────────────

/** A pending "prove you hold this key" request. */
export interface KeyLinkChallenge {
  /** The member asking (their Telegram id). */
  telegramId: string;
  /** The key they claim, 64-hex. */
  pubkey: string;
  /** What they must publish, verbatim, in a note signed by that key. */
  code: string;
  /** Unix seconds the challenge was issued; proofs must be newer. */
  issuedAt: number;
}

export const KEY_LINK_CODE_PREFIX = 'holons-link-';
/** A challenge older than this is stale — never accepted. */
export const KEY_LINK_TTL_SEC = 15 * 60;

/** Random, readable, unguessable: 8 chars from a 32-symbol alphabet. */
function randomCode(random: () => number): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 8; i++) out += alphabet[Math.floor(random() * alphabet.length) % alphabet.length];
  return out;
}

/** Issue a challenge for `pubkey` (hex or npub); throws on an unparsable key. */
export function buildKeyLinkChallenge(
  telegramId: string | number,
  pubkey: string,
  opts: { now?: number; random?: () => number } = {},
): KeyLinkChallenge {
  const pk = normalizePubkey(pubkey);
  if (!pk) throw new Error('buildKeyLinkChallenge: expected a 64-char hex pubkey or an npub');
  return {
    telegramId: String(telegramId),
    pubkey: pk,
    code: KEY_LINK_CODE_PREFIX + randomCode(opts.random ?? Math.random),
    issuedAt: opts.now ?? Math.floor(Date.now() / 1000),
  };
}

/** The minimal event shape a proof check needs. */
export interface ProofEventLike {
  pubkey: string;
  created_at: number;
  content: string;
}

/** The relay filter that fetches candidate proofs for a challenge. */
export function keyLinkProofFilter(challenge: KeyLinkChallenge): { authors: string[]; since: number; limit: number } {
  return { authors: [challenge.pubkey], since: challenge.issuedAt, limit: 50 };
}

/**
 * True when one of `events` is a note by the claimed key, created after the
 * challenge was issued, whose content carries the code. Signature validity is
 * the relay client's job (nostr-tools verifies on receipt); this checks the
 * claim, the freshness, and that the challenge itself has not expired.
 */
export function verifyKeyLinkProof(
  events: Iterable<ProofEventLike>,
  challenge: KeyLinkChallenge,
  opts: { now?: number; ttlSec?: number } = {},
): boolean {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (now - challenge.issuedAt > (opts.ttlSec ?? KEY_LINK_TTL_SEC)) return false;
  for (const ev of events) {
    if (ev.pubkey?.toLowerCase() !== challenge.pubkey) continue;
    if (ev.created_at < challenge.issuedAt) continue;
    if (typeof ev.content === 'string' && ev.content.includes(challenge.code)) return true;
  }
  return false;
}

// ── Projection hook ────────────────────────────────────────────────────────

export interface LinkedKeysResolverOptions {
  /** How long a member's answer is reused before re-reading (ms; default 60 s). */
  ttlMs?: number;
  now?: () => number;
}

/**
 * A `ProjectionCtx.linkedKeysFor` implementation over a Holosphere-shaped DB:
 * synchronous by contract, so the first call for a member returns undefined
 * and warms a cache from their personal-holon record; later calls (and every
 * re-projection after `ttlMs`) answer from it. `invalidate(id)` after a
 * link/unlink makes the next projection see the change at once.
 */
export function createLinkedKeysResolver(
  db: Pick<UserDB, 'get'>,
  opts: LinkedKeysResolverOptions = {},
): { linkedKeysFor: (userId: string | number) => readonly string[] | undefined; invalidate: (userId?: string | number) => void } {
  const ttl = opts.ttlMs ?? 60_000;
  const now = opts.now ?? Date.now;
  const cache = new Map<string, { at: number; keys: string[] | undefined; pending: boolean }>();
  function warm(id: string) {
    const entry = { at: now(), keys: cache.get(id)?.keys, pending: true };
    cache.set(id, entry);
    Promise.resolve(db.get(id, 'users', id))
      .then((rec) => {
        entry.keys = linkedKeysOf(rec as UserProfile | null);
      })
      .catch(() => {
        /* keep whatever we had */
      })
      .finally(() => {
        entry.pending = false;
      });
  }
  return {
    linkedKeysFor(userId) {
      const id = String(userId);
      const hit = cache.get(id);
      if (!hit) {
        warm(id);
        return undefined;
      }
      if (!hit.pending && now() - hit.at > ttl) warm(id);
      return hit.keys;
    },
    invalidate(userId) {
      if (userId === undefined) cache.clear();
      else cache.delete(String(userId));
    },
  };
}
