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
import { eventToItem } from 'holosphere/nostr-events.js';
import { isValidCell } from 'h3-js';
import { bootstrapFromLenses } from '../protocol/bootstrap.js';
import { actorsFromMembersLog, bootstrapActors } from '../protocol/membership.js';
import type { AcceptedActors, Role } from '../protocol/types.js';
import { attestationsFrom, SHIFT_IDENTITY_LENS } from '../shifts/wire.js';
import type { IdentityAttestation } from '../shifts/attestation.js';
import { linkedKeysOf } from '../users/keys.js';

export type AuthorityPredicate = ((pubkey: string, createdAt: number) => boolean) & {
  /** The role the key held at that time, when the authority knows roles: the signer guards settings with it. */
  roleAt?: (pubkey: string, createdAt: number) => Role | null;
};

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

/**
 * The keys that read on behalf of a personal holon: the key itself and
 * what it linked in its own signed `users` record. Sorted, lowercase.
 */
export function personalReaderKeys(hs: HoloSphere, pubkey: string): string[] {
  const key = String(pubkey).toLowerCase();
  const members = new Set<string>([key]);
  for (const u of itemsByAuthor((hs as AuthorityHost).store, key, 'users', key)) {
    for (const k of linkedKeysOf(u as never)) if (HEX64.test(k)) members.add(k.toLowerCase());
  }
  return [...members].sort();
}

/** Personal holon: the key itself and what it linked, signed by itself. */
function personalActors(hs: AuthorityHost, holon: string): AcceptedActors {
  const key = holon.toLowerCase();
  return bootstrapActors({ members: new Set(personalReaderKeys(hs, key)), admins: [key], genesis: key });
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
    // The records above were signed by the anchor itself: its word on who linked what.
    trustUsers: true,
  });
  return { anchor, actors: bootstrapActors(boot.actors) };
}

export interface ReadAuthorityOptions {
  /** How long a holon's answer is kept before the envelopes are read again. */
  ttlMs?: number;
}

/** What the signer asks about a pointer or federated copy an unseated key wrote (holosphere `VouchContext`). */
export interface VouchContext {
  holon: string;
  lens: string;
  id: string;
  claim: Record<string, any>;
  author: string;
  createdAt: number;
  resolved: Record<string, any>;
}

export interface ReadAuthority {
  /** The signer hook: `(pubkey, created_at) => boolean`, or null when nobody is defined. */
  authorityFor(hs: HoloSphere, holon: string): Promise<AuthorityPredicate | null>;
  /**
   * The signer's vouch hook: may a pointer or federated copy count although
   * its author is not seated in the holon it was written into? Yes when
   * the TARGET vouches (the quest it points at names this holon among its
   * participants or hosts), or when the SOURCE speaks for it (its author is
   * accepted in the source holon and this holon receives from that source).
   */
  vouchFor(hs: HoloSphere, ctx: VouchContext): Promise<boolean>;
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
  /** The role the key holds now (`accepted` only): what `may()` weighs an action against. */
  role: Role | null;
  /** The key that speaks for the holon, when known. */
  anchor: string | null;
  /** How the authority was found: its signed log, its anchored records, or nothing. */
  source: 'log' | 'bootstrap' | null;
}

type AuthorityCarrier = HoloSphere & {
  _readAuthority?: ReadAuthority;
  currentPubkey?: string;
  _relaySync?: (holon: string, lens: string, opts?: { await?: boolean }) => Promise<unknown>;
};

/**
 * Does `pubkey` (default: the instance's signing key) count for `holon`
 * right now? Uses the instance's own read authority when the factory wired
 * one, so the answer is exactly what its reads enforce.
 */
export async function writeAcceptance(hs: HoloSphere, holon: string, pubkey?: string | null): Promise<WriteStanding> {
  const host = hs as AuthorityCarrier;
  const key = String(pubkey ?? host.currentPubkey ?? '').toLowerCase();
  const h = String(holon ?? '').trim();
  // The answer is only as good as the log in the store: on a cold instance
  // the holon would read as "open" until its `_members` envelopes arrive,
  // and a surface would offer controls whose writes will not count. Catch
  // the log (and the anchored settings) up first, and forget the cached
  // answer that may predate them.
  if (h && !isPubkeyHolon(h) && !isValidCell(h)) {
    try { await host._relaySync?.(h, '_members', { await: true }); } catch { /* offline: the store decides */ }
    try { await host._relaySync?.(h, 'settings', { await: true }); } catch { /* offline: the store decides */ }
    host._readAuthority?.invalidate(h);
  }
  const summary = resolveHolonAuthority(hs, h);
  const source = summary.actors?.source ?? null;
  const predicate: AuthorityPredicate | null = host._readAuthority
    ? await host._readAuthority.authorityFor(hs, h)
    : summary.actors
      ? (pub: string, at: number) => summary.actors!.isAcceptedAt(pub, at)
      : null;
  if (!predicate) return { status: 'open', role: null, anchor: summary.anchor, source };
  const now = Math.floor(Date.now() / 1000);
  const accepted = !!key && predicate(key, now);
  const role = accepted ? (predicate.roleAt?.(key, now) ?? summary.actors?.roleAt(key, now) ?? 'member') : null;
  return { status: accepted ? 'accepted' : 'held', role, anchor: summary.anchor, source };
}

/**
 * The role a key holds in a holon right now, SYNCHRONOUSLY from what the
 * instance holds — the privacy layer's `roleOf` hook, which decides whose
 * vault record counts. 'admin' | 'member' | null (a stranger) | undefined
 * (nobody speaks for the holon: it is open).
 */
export function roleOfSync(hs: HoloSphere, holon: string, pubkey: string): Role | null | undefined {
  const { actors } = resolveHolonAuthority(hs, holon);
  if (!actors) return undefined;
  return actors.roleAt(String(pubkey).toLowerCase(), Math.floor(Date.now() / 1000));
}

/** `app/holon/lens/key` → its holon, or null. */
function soulHolon(soul: unknown): string | null {
  if (typeof soul !== 'string') return null;
  const parts = soul.split('/');
  return parts.length >= 4 && parts[1] ? parts[1] : null;
}

/** Where a pointer or federated copy comes from: the soul's holon, else the `_federation.origin` stamp. */
export function sourceHolonOf(claim: Record<string, any> | null | undefined): string | null {
  if (!claim || typeof claim !== 'object') return null;
  return soulHolon(claim.soul) ?? (typeof claim._federation?.origin === 'string' && claim._federation.origin ? String(claim._federation.origin) : null);
}

/**
 * Does an item name this holon as one of its people? Participants and hosts
 * are matched by id (a Telegram id IS the personal holon id) and by pubkey
 * (a pubkey holon and the keys it linked). The initiator does not count:
 * creating a quest elsewhere is not taking part in it here.
 */
export function namesHolon(item: Record<string, any> | null | undefined, holon: string, keys: Iterable<string> = []): boolean {
  if (!item || typeof item !== 'object') return false;
  const h = String(holon).trim().toLowerCase();
  const accepted = new Set<string>([h]);
  for (const k of keys) accepted.add(String(k).toLowerCase());
  const matches = (p: unknown): boolean => {
    if (p == null) return false;
    if (typeof p !== 'object') return accepted.has(String(p).toLowerCase());
    const o = p as Record<string, unknown>;
    for (const f of ['id', 'pubkey', 'userId', 'holon']) if (o[f] != null && accepted.has(String(o[f]).toLowerCase())) return true;
    return false;
  };
  for (const field of ['participants', 'hosts']) {
    const list = item[field];
    if (Array.isArray(list) && list.some(matches)) return true;
  }
  return false;
}

/**
 * Does `holon` receive `lens` from `source`? Read from the holon's own
 * federation record as signed by one of its accepted keys — a partner that
 * only linked from its side has not been let in.
 */
function receivesFrom(hs: AuthorityHost, holon: string, source: string, lens: string, accepted: AuthorityPredicate): boolean {
  // The federation record is an admin's word (capabilities.js): a member's
  // or a stranger's copy of it lets nobody in.
  const counts = (pub: string, at: number) => (accepted.roleAt ? accepted.roleAt(pub, at) === 'admin' : accepted(pub, at));
  const events = hs.store.getEvents(null, 'federation', holon)
    .filter((e) => counts(String(e.pubkey).toLowerCase(), e.created_at))
    .sort((a, b) => (b.created_at - a.created_at) || (a.id < b.id ? 1 : -1));
  if (!events.length) return false;
  const record = eventToItem(events[0]) as Record<string, any> | null;
  if (!record) return false;
  const partners: unknown[] = Array.isArray(record.inbound) ? record.inbound : Array.isArray(record.federated) ? record.federated : [];
  if (!partners.some((p) => String(p) === source)) return false;
  const cfg = record.lensConfig?.[source];
  return !cfg || !Array.isArray(cfg.inbound) || cfg.inbound.includes(lens);
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
      const p: AuthorityPredicate = (pubkey, createdAt) => actors.isAcceptedAt(String(pubkey).toLowerCase(), createdAt);
      p.roleAt = (pubkey, createdAt) => actors.roleAt(String(pubkey).toLowerCase(), createdAt);
      return p;
    },
    async vouchFor(hs, ctx) {
      const host = hs as AuthorityHost;
      const h = String(ctx.holon ?? '').trim();
      const source = sourceHolonOf(ctx.claim);
      if (!h || !source || source === h) return false;
      // The target vouches: the quest it points at names this holon.
      if (soulHolon(ctx.claim?.soul) && namesHolon(ctx.resolved, h, isPubkeyHolon(h) ? personalReaderKeys(hs, h) : [])) return true;
      // The source speaks for it: its accepted author, and this holon lets that source in.
      const srcAccepted = await this.authorityFor(hs, source);
      if (!srcAccepted || !srcAccepted(String(ctx.author).toLowerCase(), ctx.createdAt)) return false;
      const mine = await this.authorityFor(hs, h);
      return !!mine && receivesFrom(host, h, source, ctx.lens, mine);
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
