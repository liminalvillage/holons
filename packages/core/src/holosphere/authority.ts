// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Who counts, for every read: the rule holosphere's `enforce: 'authority'`
 * mode asks core for, per holon.
 *
 *   - a pubkey holon is its key (plus the keys that person linked in their
 *     own signed `users` record);
 *   - a founded holon is its signed `_members` log, folded as-of-time;
 *   - a holon nobody founded is bootstrapped from its own records — but only
 *     the ones its ANCHOR signed (the earliest self-signed `holonPubkey`
 *     declaration; see holosphere/authority.js): the members' linked keys,
 *     the trusted pubkeys, the admin — plus the identity directory
 *     (kind 31926), which is provider-signed;
 *   - an h3 cell (a scale-space aggregate of many holons) and a holon with
 *     nothing signed about it have nobody defined: they read unenforced.
 *
 * The same rule answers "may this key hand out (or edit under) keys of the
 * holon" for the privacy layer. Results are cached briefly per holon; the
 * inputs are read straight from envelopes (never through `get`, which would
 * recurse into this very rule).
 */

import type { HoloSphere } from 'holosphere';
import { holonAnchor, isPubkeyHolon, itemsByAuthor, membersEvents } from 'holosphere/authority.js';
import { isValidCell } from 'h3-js';
import { bootstrapFromLenses } from '../protocol/bootstrap.js';
import { actorsFromMembersLog, bootstrapActors } from '../protocol/membership.js';
import type { AcceptedActors } from '../protocol/types.js';
import { attestationsFrom, SHIFT_IDENTITY_LENS } from '../shifts/wire.js';
import type { IdentityAttestation } from '../shifts/attestation.js';
import { linkedKeysOf } from '../users/keys.js';

export type AuthorityPredicate = (pubkey: string, createdAt: number) => boolean;

export interface HolonAuthority {
  /** The key that speaks for the holon, when something signed says so. */
  anchor: string | null;
  /** Who counts, or null when nobody is defined (the holon reads unenforced). */
  actors: AcceptedActors | null;
}

type AuthorityHost = HoloSphere & {
  store: { listEventIds(holon: string | null, lens: string): string[]; getEvents(holon: string | null, lens: string, id: string): any[]; wire?: { isStandardPrimary?(lens: string): boolean } };
  getAllGlobal?: (lens: string) => Promise<unknown[]>;
};

const HEX64 = /^[0-9a-f]{64}$/i;

/** Personal holon: the key itself and what it linked, signed by itself. */
function personalActors(hs: AuthorityHost, holon: string): AcceptedActors {
  const key = holon.toLowerCase();
  const members = new Set<string>([key]);
  for (const u of itemsByAuthor(hs.store, key, 'users', key)) {
    for (const k of linkedKeysOf(u as never)) if (HEX64.test(k)) members.add(k.toLowerCase());
  }
  return bootstrapActors({ members, admins: [key], genesis: key });
}

/**
 * Resolve a holon's authority from what the instance holds. `attestations`
 * is the identity directory when the caller already has it.
 */
export function resolveHolonAuthority(hs: HoloSphere, holon: string, attestations: Iterable<IdentityAttestation> = []): HolonAuthority {
  const host = hs as AuthorityHost;
  const h = String(holon ?? '').trim();
  if (!h) return { anchor: null, actors: null };
  if (isPubkeyHolon(h)) return { anchor: h.toLowerCase(), actors: personalActors(host, h) };
  if (isValidCell(h)) return { anchor: null, actors: null };
  const log = membersEvents(host.store, h);
  const fromLog = log.length ? actorsFromMembersLog(log) : null;
  if (fromLog) return { anchor: fromLog.genesis, actors: fromLog };
  const anchor = holonAnchor(host.store, h);
  if (!anchor) return { anchor: null, actors: null };
  const [settings] = itemsByAuthor(host.store, h, 'settings', anchor).filter((s) => String(s?.id ?? h) === h);
  const boot = bootstrapFromLenses({
    holonId: h,
    settings: settings ?? null,
    users: itemsByAuthor(host.store, h, 'users', anchor),
    attestations,
    holonPubkey: anchor,
  });
  return { anchor, actors: bootstrapActors(boot.actors) };
}

export interface ReadAuthorityOptions {
  /** How long a holon's answer is kept before the envelopes are read again. */
  ttlMs?: number;
}

export interface ReadAuthority {
  /** The signer hook: `(pubkey, created_at) => boolean`, or null when nobody is defined. */
  authorityFor(hs: HoloSphere, holon: string): Promise<AuthorityPredicate | null>;
  /** The privacy hook: may `sender` hand out keys of `holon`? */
  acceptGrantFrom(hs: HoloSphere, holon: string, lens: string, sender: string): Promise<boolean>;
  /** Forget cached answers (all, or one holon's). */
  invalidate(holon?: string): void;
}

/** Where a key stands with a holon, for a UI to say so before the person writes. */
export type WriteAcceptance = 'accepted' | 'held' | 'open';

export interface WriteStanding {
  /** `accepted`: the key counts here. `held`: the holon has an authority and it is not this key — writes stay with their author. `open`: nobody is defined, every claim shows. */
  status: WriteAcceptance;
  /** The key that speaks for the holon, when known. */
  anchor: string | null;
  /** How the authority was found: its signed log, its anchored records, or nothing. */
  source: 'log' | 'bootstrap' | null;
}

type AuthorityCarrier = HoloSphere & { _readAuthority?: ReadAuthority; currentPubkey?: string };

/**
 * Does `pubkey` (default: the instance's signing key) count for `holon`
 * right now? Uses the instance's own read authority when the factory wired
 * one, so the answer is exactly what its reads enforce.
 */
export async function writeAcceptance(hs: HoloSphere, holon: string, pubkey?: string | null): Promise<WriteStanding> {
  const host = hs as AuthorityCarrier;
  const key = String(pubkey ?? host.currentPubkey ?? '').toLowerCase();
  const h = String(holon ?? '').trim();
  const summary = resolveHolonAuthority(hs, h);
  const source = summary.actors?.source ?? null;
  const predicate = host._readAuthority
    ? await host._readAuthority.authorityFor(hs, h)
    : summary.actors
      ? (pub: string, at: number) => summary.actors!.isAcceptedAt(pub, at)
      : null;
  if (!predicate) return { status: 'open', anchor: summary.anchor, source };
  const accepted = !!key && predicate(key, Math.floor(Date.now() / 1000));
  return { status: accepted ? 'accepted' : 'held', anchor: summary.anchor, source };
}

/** One cached rule for an instance: what the factory wires into the signer and the privacy layer. */
export function createReadAuthority({ ttlMs = 10_000 }: ReadAuthorityOptions = {}): ReadAuthority {
  const cache = new Map<string, { at: number; value: Promise<HolonAuthority> }>();
  let directory: { at: number; value: Promise<IdentityAttestation[]> } | null = null;

  const attestations = (hs: AuthorityHost): Promise<IdentityAttestation[]> => {
    if (directory && Date.now() - directory.at < ttlMs) return directory.value;
    const value = (async () => {
      if (!hs.store.wire?.isStandardPrimary?.(SHIFT_IDENTITY_LENS) || typeof hs.getAllGlobal !== 'function') return [];
      try { return attestationsFrom(((await hs.getAllGlobal(SHIFT_IDENTITY_LENS)) ?? []) as never); } catch { return []; }
    })();
    directory = { at: Date.now(), value };
    return value;
  };

  const resolve = (hs: HoloSphere, holon: string): Promise<HolonAuthority> => {
    const h = String(holon ?? '').trim();
    const hit = cache.get(h);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
    const value = (async () => {
      // Personal holons and founded holons need no directory; only a
      // bootstrap does, and it is provider-signed so it is safe to read.
      const quick = resolveHolonAuthority(hs, h, []);
      if (quick.actors && quick.actors.source === 'log') return quick;
      if (isPubkeyHolon(h) || !quick.anchor) return quick;
      return resolveHolonAuthority(hs, h, await attestations(hs as AuthorityHost));
    })();
    cache.set(h, { at: Date.now(), value });
    return value;
  };

  return {
    async authorityFor(hs, holon) {
      const { actors } = await resolve(hs, holon);
      if (!actors) return null;
      return (pubkey, createdAt) => actors.isAcceptedAt(String(pubkey).toLowerCase(), createdAt);
    },
    async acceptGrantFrom(hs, holon, _lens, sender) {
      const s = String(sender ?? '').toLowerCase();
      if (!HEX64.test(s)) return false;
      const h = String(holon ?? '').trim();
      if (s === h.toLowerCase()) return true;
      const { actors } = await resolve(hs, h);
      return !!actors && actors.isAcceptedAt(s, Number.MAX_SAFE_INTEGER);
    },
    invalidate(holon) {
      if (holon === undefined) { cache.clear(); directory = null; } else cache.delete(String(holon).trim());
    },
  };
}
