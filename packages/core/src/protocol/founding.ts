// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Founding a holon from a screen, with a person's own key.
 *
 * A holon is founded when a key signs the genesis of its `_members` log and
 * declares itself in the holon's `settings.holonPubkey` (see
 * holosphere/authority.js: the earliest self-consistent declaration is the
 * anchor every reader trusts). The bot does this for Telegram chats with the
 * holon key it holds. Nothing in that rule needs Telegram: any signed-in key
 * can found a holon it starts, become its first admin, and hand out membership
 * by key — this module is that path, shared by the kiosk and the web.
 *
 * Who may found what is the one rule here (`foundingAuthority`):
 *
 *   - a pubkey holon is its own key and needs no founding;
 *   - an h3 cell aggregates many holons and has no founder;
 *   - a Telegram chat id is the bot's to found (a person founding it from a
 *     screen would lock the bot out as admin);
 *   - a holon someone already anchored is theirs;
 *   - anything else is open — the first signed genesis wins, so a holon minted
 *     here (`newHolonId`) is founded in the same breath it is created.
 */

import type { HoloSphere } from 'holosphere';
import { isValidCell } from 'h3-js';
import { holonAnchor, isPubkeyHolon } from 'holosphere/authority.js';
import { normalizePubkey } from '../users/keys.js';
import { nextMembersAt } from './membership.js';
import type { Role } from './types.js';

/** Ids minted by `newHolonId` start with this. */
export const HOLON_ID_PREFIX = 'holon_';
/**
 * The prefix the first key-founded holons were minted with (2026-09-26).
 * Still recognised everywhere an id is checked; nothing new is minted with it.
 */
export const LEGACY_HOLON_ID_PREFIX = 'hub_';
// 32 unambiguous lowercase symbols: 16 of them carry 80 bits, and `& 31`
// draws each one without bias.
const ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const ID_LENGTH = 16;
/** A key-founded holon id: `holon_…`, or the legacy `hub_…`. */
export const HOLON_ID_RE = /^(holon|hub)_[a-z0-9]{12,32}$/;
const TELEGRAM_ID_RE = /^-?\d{1,20}$/;
const HEX64 = /^[0-9a-f]{64}$/i;

/** Random bytes; injectable so specs can pin an id. */
export type RandomBytes = (n: number) => Uint8Array;

function defaultRandomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  const c = (globalThis as { crypto?: { getRandomValues?: (b: Uint8Array) => Uint8Array } }).crypto;
  if (!c?.getRandomValues) throw new Error('No secure random source available');
  c.getRandomValues(buf);
  return buf;
}

/** Mint the id of a holon that is not a Telegram chat. */
export function newHolonId(randomBytes: RandomBytes = defaultRandomBytes): string {
  const bytes = randomBytes(ID_LENGTH);
  let out = HOLON_ID_PREFIX;
  for (let i = 0; i < ID_LENGTH; i++) out += ID_ALPHABET[bytes[i] & 31];
  return out;
}

/** Is this an id `newHolonId` could have minted — or one of the first, `hub_`-prefixed ones (shape only)? */
export function isHolonId(value: unknown): value is string {
  return typeof value === 'string' && HOLON_ID_RE.test(value);
}

/** A Telegram chat id (a user's, or a group's negative one): the bot's holon. */
export function isTelegramChatId(holon: unknown): boolean {
  return typeof holon === 'string' && TELEGRAM_ID_RE.test(holon.trim());
}

export type FoundingAuthority =
  /** Someone's key already speaks for the holon; `own` when it is this instance's. */
  | { kind: 'anchored'; anchor: string; own: boolean }
  /** A pubkey holon: its own key, nothing to found. */
  | { kind: 'self'; anchor: string }
  /** An h3 cell: an aggregate, nobody founds it. */
  | { kind: 'cell' }
  /** A Telegram chat: its bot founds it. */
  | { kind: 'bot' }
  /** Nothing signed yet, and a person's key may found it. */
  | { kind: 'open' };

type AuthorityHost = HoloSphere & {
  store: { listEventIds(holon: string | null, lens: string): string[]; getEvents(holon: string | null, lens: string, id: string): unknown[] };
  _readAuthority?: { invalidate(holon?: string): void };
};

/**
 * Who may found `holon`, from what this instance already holds. Read the
 * relays first (`syncFoundingAuthority`) before acting on an `open` answer.
 */
export function foundingAuthority(hs: HoloSphere, holon: string): FoundingAuthority {
  const host = hs as AuthorityHost;
  const h = String(holon ?? '').trim();
  if (!h) return { kind: 'cell' };
  if (isPubkeyHolon(h)) return { kind: 'self', anchor: h.toLowerCase() };
  if (isValidCell(h)) return { kind: 'cell' };
  const anchor = holonAnchor(host.store, h);
  if (anchor) return { kind: 'anchored', anchor, own: anchor === String(hs.currentPubkey ?? '').toLowerCase() };
  if (isTelegramChatId(h)) return { kind: 'bot' };
  return { kind: 'open' };
}

/** `foundingAuthority` after catching the holon's log and settings up from the relays. */
export async function syncFoundingAuthority(hs: HoloSphere, holon: string): Promise<FoundingAuthority> {
  const h = String(holon ?? '').trim();
  if (h && !isPubkeyHolon(h) && !isValidCell(h)) {
    await hs.ready();
    try { await hs.getMembers(h); } catch { /* not signing: nothing to sync */ }
    try { await hs.get(h, 'settings', h); } catch { /* absent, or held: the store is what counts */ }
  }
  return foundingAuthority(hs, h);
}

export interface FoundHolonOptions {
  /** The holon's name, written into its settings. */
  name?: string;
  /** Keys to seat beside the founder (hex or npub → role). */
  members?: Iterable<[string, Role]>;
}

export interface FoundHolonResult {
  holon: string;
  /** The key that now speaks for the holon. */
  anchor: string;
  /** False when this key had already founded it (the call then only tops up). */
  founded: boolean;
  /** Keys seated by this call. */
  added: string[];
}

function anchorError(auth: FoundingAuthority): string {
  switch (auth.kind) {
    case 'self': return 'A personal holon is its own key and needs no founding.';
    case 'cell': return 'A cell aggregates many holons: nobody founds it.';
    case 'bot': return 'This holon was born in Telegram: its bot founds it.';
    case 'anchored': return 'Another key already speaks for this holon.';
    default: return 'This holon cannot be founded.';
  }
}

async function readSettings(hs: HoloSphere, h: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await hs.get(h, 'settings', h);
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Found `holon` with this instance's key: sign the genesis, seat `members`,
 * and declare the key in the holon's settings so browsers pin the same anchor.
 * Idempotent for the founder (a second call only adds what is missing);
 * refuses a holon that is someone else's to found.
 */
export async function foundHolon(hs: HoloSphere, holon: string, opts: FoundHolonOptions = {}): Promise<FoundHolonResult> {
  const h = String(holon ?? '').trim();
  if (!h) throw new Error('foundHolon: a holon id is required');
  const me = String(hs.currentPubkey ?? '').toLowerCase();
  if (!me || !hs.signingEnabled) throw new Error('foundHolon: sign in with a key first');

  const auth = await syncFoundingAuthority(hs, h);
  if (auth.kind !== 'open' && !(auth.kind === 'anchored' && auth.own)) throw new Error(anchorError(auth));

  let founded = false;
  if (auth.kind === 'open') {
    await hs.foundHolon(h);
    founded = true;
  }

  const added: string[] = [];
  const current = await hs.getMembers(h);
  for (const [key, role] of opts.members ?? []) {
    const pub = normalizePubkey(key);
    if (!pub || pub === me) continue;
    const want: Role = role === 'admin' ? 'admin' : 'member';
    if (current.get(pub) === want) continue;
    await hs.addMember(h, pub, want, { at: await nextMembersAt(hs, h) });
    added.push(pub);
  }

  const existing = (await readSettings(hs, h)) ?? {};
  const name = typeof opts.name === 'string' ? opts.name.trim() : '';
  const declared = typeof existing.holonPubkey === 'string' ? existing.holonPubkey.toLowerCase() : '';
  if (declared !== me || (name && existing.name !== name) || String(existing.id ?? '') !== h) {
    const next: Record<string, unknown> = { ...existing, id: h, holonPubkey: me };
    if (name) next.name = name;
    await hs.put(h, 'settings', next);
  }

  (hs as AuthorityHost)._readAuthority?.invalidate?.(h);
  return { holon: h, anchor: me, founded, added };
}

/** The holon's current members (pubkey → role), from its signed log. */
export async function holonMembers(hs: HoloSphere, holon: string): Promise<Map<string, Role>> {
  const out = new Map<string, Role>();
  if (!hs.signingEnabled) return out;
  for (const [pub, role] of await hs.getMembers(String(holon))) out.set(pub, role === 'admin' ? 'admin' : 'member');
  return out;
}

/** This instance's role in the holon's log, or null when its key is not seated. */
export async function myHolonRole(hs: HoloSphere, holon: string): Promise<Role | null> {
  const me = String(hs.currentPubkey ?? '').toLowerCase();
  if (!me) return null;
  return (await holonMembers(hs, holon)).get(me) ?? null;
}

async function requireAdmin(hs: HoloSphere, h: string): Promise<string> {
  const me = String(hs.currentPubkey ?? '').toLowerCase();
  if (!me || !hs.signingEnabled) throw new Error('Sign in with a key first.');
  if ((await myHolonRole(hs, h)) !== 'admin') throw new Error('Only an admin of this holon can change its keys.');
  return me;
}

/**
 * Seat a key (hex or npub) in the holon, signed by this instance — which must
 * be an admin of the log for the entry to count.
 */
export async function addHolonMember(hs: HoloSphere, holon: string, key: string, role: Role = 'member'): Promise<string> {
  const h = String(holon ?? '').trim();
  const pub = normalizePubkey(key);
  if (!pub || !HEX64.test(pub)) throw new Error('That is not a Nostr public key (hex or npub).');
  const me = await requireAdmin(hs, h);
  if (pub === me) return pub;
  await hs.addMember(h, pub, role === 'admin' ? 'admin' : 'member', { at: await nextMembersAt(hs, h) });
  (hs as AuthorityHost)._readAuthority?.invalidate?.(h);
  return pub;
}

/** Unseat a key from the holon (admins only; never the caller's own key). */
export async function removeHolonMember(hs: HoloSphere, holon: string, key: string): Promise<string> {
  const h = String(holon ?? '').trim();
  const pub = normalizePubkey(key);
  if (!pub) throw new Error('That is not a Nostr public key (hex or npub).');
  const me = await requireAdmin(hs, h);
  if (pub === me) throw new Error('You cannot remove your own key.');
  await hs.removeMember(h, pub, { at: await nextMembersAt(hs, h) });
  (hs as AuthorityHost)._readAuthority?.invalidate?.(h);
  return pub;
}
