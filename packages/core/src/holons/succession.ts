// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Succession — one holon carrying on under a new id.
//
// A holon's id can change under it without the holon changing: Telegram
// gives a group a new chat id when it becomes a supergroup (a visibility
// change is enough), and the bot's holon id IS the chat id. Left alone, the
// new id is an empty holon and everything done before is stranded under the
// old one.
//
// `succeedHolon(from, to)` is the one operation that carries a holon across:
//
//   1. the new holon is founded with the old roster — every key that counted
//      keeps counting;
//   2. the old holon's records are copied in, re-signed by the key running
//      this (an admin of both), keeping their ids;
//   3. the people a task or event names get their own-holon mirror pointed at
//      the card's new address;
//   4. a pair of signed records names each side from the other —
//      `from/succession/successor` and `to/succession/predecessor:<from>` —
//      and, as with a link, a successor counts only when an admin of EACH
//      holon signed its half (`readSuccessor`). `resolveHolon` follows them.
//
// The new holon's own records always win: a copy fills gaps, it never
// replaces what people wrote there (unless told to), and never brings back
// what they deleted. Run twice, the second run writes nothing.
//
// Not carried, and reported instead of guessed at:
//   - append-only logs (claims, mints, votes, policy): their entries are
//     signed, cite each other by event id, and count by who signed them —
//     re-signing would rewrite history;
//   - sealed lenses and items: the new holon has no vault yet, so a copy
//     would publish the plaintext;
//   - reserved `_…` lenses (the roster is replayed, not copied), the
//     Telegram `links` pair (the other holon's half names the old id) and
//     the federation record (each partner's half does too).
//
// Nothing is removed from the old holon.

import type { HoloSphere } from 'holosphere';
import { isValidCell } from 'h3-js';
import { isPubkeyHolon } from 'holosphere/authority.js';
import { eventToItem } from 'holosphere/nostr-events.js';
import { myHolonRole } from '../protocol/founding.js';
import { actorsFromMembersLog, readMembersLog, syncMembersLog } from '../protocol/membership.js';
import type { Role } from '../protocol/types.js';
import { REA_EVENTS_LENS } from '../rea/ledger.js';
import { ROSTER_LENSES, rosterOf } from '../tasks/roster-mirror.js';
import type { Quest } from '../tasks/types.js';
import { personalHolonOf } from '../users/keys.js';

/** The lens, in both holons, that holds the succession records. */
export const SUCCESSION_LENS = 'succession';
/** The old holon's record: where it carries on. */
export const SUCCESSOR_ID = 'successor';
/** The new holon's record ids: `predecessor:<old id>` (a holon may take in more than one). */
export const PREDECESSOR_PREFIX = 'predecessor:';

/** The Telegram link pair (`@holons/core/linking`) — named here, not imported, to keep the two domains apart. */
const LINKS_LENS = 'links';
const SETTINGS_LENS = 'settings';
/** How far a chain of successors is followed. */
const MAX_HOPS = 8;

export interface SuccessionRecord {
  /** `successor`, or `predecessor:<holon>`. */
  id: string;
  /** The other holon. */
  holon: string;
  /** Who wrote it (pubkey). */
  by?: string;
  /** ms epoch. */
  at: number;
}

/** Something `succeedHolon` can move between: a founded holon's id, not an address, a person's key or a cell. */
function isMovableId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const h = value.trim();
  return !!h && h === value && !h.includes('/') && !isPubkeyHolon(h) && !isValidCell(h);
}

export function isSuccessionRecord(value: unknown): value is SuccessionRecord {
  const r = value as SuccessionRecord;
  if (!r || typeof r !== 'object' || typeof r.id !== 'string') return false;
  if (r.id !== SUCCESSOR_ID && !(r.id.startsWith(PREDECESSOR_PREFIX) && r.id.slice(PREDECESSOR_PREFIX.length) === r.holon)) return false;
  return isMovableId(r.holon) && typeof r.at === 'number' && Number.isFinite(r.at) && (r.by === undefined || typeof r.by === 'string');
}

// ── Reading ────────────────────────────────────────────────────────────────

type Host = HoloSphere & {
  store: {
    getEvents(holon: string | null, lens: string, id: string): Array<{ pubkey: string; created_at: number }>;
  };
  _readAuthority?: { invalidate(holon?: string): void };
};

const me = (hs: HoloSphere) => String(hs.currentPubkey ?? '').toLowerCase();

/**
 * The succession record `id` in `holon`, as signed by a key that was an ADMIN
 * of the holon at that moment — the newest such envelope. A plain read would
 * hand back the newest claim by any accepted member; only an admin may say
 * where a holon went or what it took in.
 */
async function adminRecord(hs: HoloSphere, holon: string, id: string): Promise<SuccessionRecord | null> {
  const host = hs as Host;
  try {
    await hs.getMembers(holon);
  } catch {
    return null; // not signing: nothing can be judged
  }
  host._readAuthority?.invalidate?.(holon);
  try {
    await hs.get(holon, SUCCESSION_LENS, id);
  } catch {
    /* absent */
  }
  const actors = actorsFromMembersLog(await readMembersLog(hs, holon));
  if (!actors) return null;
  const events = host.store
    .getEvents(holon, SUCCESSION_LENS, id)
    .filter((e) => actors.roleAt(String(e.pubkey).toLowerCase(), e.created_at) === 'admin')
    .sort((a, b) => b.created_at - a.created_at);
  for (const e of events) {
    const item = eventToItem(e as never) as unknown;
    if (isSuccessionRecord(item) && item.id === id) return item;
  }
  return null;
}

/**
 * The holon `holon` carries on as, or null: its admins' `successor` record,
 * confirmed by the named holon's admins' `predecessor` record. One half
 * alone is nothing — nobody can point a holon at one that did not take it in,
 * and nobody can claim to be the successor of one that did not say so.
 */
export async function readSuccessor(hs: HoloSphere, holon: string): Promise<string | null> {
  if (!isMovableId(holon)) return null;
  const own = await adminRecord(hs, holon, SUCCESSOR_ID);
  if (!own || own.holon === holon) return null;
  const theirs = await adminRecord(hs, own.holon, `${PREDECESSOR_PREFIX}${holon}`);
  return theirs ? own.holon : null;
}

/**
 * The id a holon is known by today: `holon` itself, or the end of its chain
 * of successors. Ends on a loop or after `maxHops`, at the last id reached.
 */
export async function resolveHolon(hs: HoloSphere, holon: string, opts: { maxHops?: number } = {}): Promise<string> {
  let current = String(holon ?? '').trim();
  const seen = new Set<string>([current]);
  for (let hop = 0; hop < (opts.maxHops ?? MAX_HOPS); hop++) {
    const next = await readSuccessor(hs, current);
    if (!next || seen.has(next)) break;
    seen.add(next);
    current = next;
  }
  return current;
}

// ── Moving ─────────────────────────────────────────────────────────────────

export type SuccessionRefusal =
  /** `from` and `to` are the same id. */
  | 'same'
  /** One of them is not a holon id (an address, a person's key, a cell, empty). */
  | 'not-holon'
  /** This key is not an admin of the old holon (or nobody founded it). */
  | 'not-admin'
  /** The new id is already someone else's holon. */
  | 'taken'
  /** The old holon already carries on somewhere else. */
  | 'moved'
  /** The new holon already carries on as the old one. */
  | 'cycle';

export type SkipReason = 'reserved' | 'log' | 'sealed' | 'link';

export interface SuccessionInput {
  /** The old id. */
  from: string;
  /** The id the holon carries on under. */
  to: string;
  /**
   * Let an old record replace a DIFFERENT one the new holon already holds
   * under the same id (default false: the new holon's own wins and the
   * difference is reported). A deletion made in the new holon always stands.
   */
  overwrite?: boolean;
  /**
   * Look and report, sign nothing: what `copied`, `seated`, `conflicts` and
   * the rest WOULD be. Nothing is founded, written or repointed.
   */
  dryRun?: boolean;
  /** Lenses to look in beyond those this instance already knows the old holon has. */
  lenses?: readonly string[];
  /** ms epoch; injectable for tests. */
  now?: number;
}

export interface SuccessionReport {
  ok: true;
  from: string;
  to: string;
  /** True when this call founded the new holon. */
  founded: boolean;
  /** Keys this call seated in the new holon. */
  seated: string[];
  /** Records written into the new holon, per lens. */
  copied: Record<string, number>;
  /** Records the new holon already held (the same, or deleted there). */
  kept: number;
  /** Ids both holons hold with different content; the new holon's stands. */
  conflicts: Array<{ lens: string; id: string }>;
  /** Whole lenses left behind, and why. */
  skipped: Array<{ lens: string; reason: SkipReason }>;
  /** Single sealed items left behind. */
  sealed: Array<{ lens: string; id: string }>;
  /** Own-holon mirrors pointed at a card's new address. */
  repointed: number;
  /** Writes that threw. */
  failed: Array<{ lens: string; id: string; error: string }>;
}

export type SuccessionResult = SuccessionReport | { ok: false; refused: SuccessionRefusal };

type Item = Record<string, any>;

type CopyHost = HoloSphere & {
  isAppendLens?(lens: string): boolean;
  queryNostr?(filter: Record<string, unknown>): Promise<unknown[]>;
  importEvents?(events: unknown[], options?: { publish?: boolean }): Promise<unknown>;
};

/** Read-side decorations and the address-bound field clock: never part of what a record says. */
const READ_SIDE = ['_clock', '_meta', '_hologram', '_verified', '_unverified'];

function clean(item: Item): Item {
  const out: Item = { ...item };
  for (const k of READ_SIDE) delete out[k];
  return out;
}

/** What a record says, as a comparable string: its own fields, key order aside. */
function said(value: unknown, top = true): string {
  if (Array.isArray(value)) return `[${value.map((v) => said(v, false)).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value as object)
      .filter((k) => !(top && k.startsWith('_')) && (value as Item)[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${said((value as Item)[k], false)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

async function rawAll(hs: HoloSphere, holon: string, lens: string, includeDeleted: boolean): Promise<Item[]> {
  try {
    const items = await hs.getAll(holon, lens, null, { resolveHolograms: false, includeDeleted });
    return (Array.isArray(items) ? items : []).filter((i) => i && typeof i === 'object' && i.id != null && String(i.id) !== '');
  } catch {
    return [];
  }
}

/** Every lens the old holon is known to have: what the relays hold for it, what the store holds, what the caller names. */
async function lensesOf(hs: CopyHost, holon: string, extra: readonly string[]): Promise<string[]> {
  try {
    const events = (await hs.queryNostr?.({ kinds: [hs.store.kind], '#h': [holon] })) ?? [];
    if (events.length) await hs.importEvents?.(events, { publish: false });
  } catch {
    /* offline: the store is what we have */
  }
  const out = new Set<string>([...hs.listLenses(holon), ...extra]);
  // The ledger first: its lines then already stand when the records they
  // derive from arrive, so the projection has nothing to add.
  return [...out].sort((a, b) => Number(b === REA_EVENTS_LENS) - Number(a === REA_EVENTS_LENS) || (a < b ? -1 : a > b ? 1 : 0));
}

function skipReason(hs: CopyHost, holon: string, lens: string): SkipReason | null {
  if (lens === SUCCESSION_LENS) return 'reserved';
  if (hs.isAppendLens?.(lens)) return 'log';
  if (lens.startsWith('_')) return 'reserved';
  if (lens === LINKS_LENS) return 'link';
  if (hs.isPrivate(holon, lens)) return 'sealed';
  return null;
}

/**
 * Every value that IS the old id becomes the new one — a quest's `holon`, an
 * announcement's `chat`, a `splitWith: [holon]` — whole values only, as a
 * string or (for a numeric id) a number. Top-level `_…` fields are stamps
 * about the record, not part of it, and stay as they are.
 */
function renamed(value: unknown, from: string, to: string, top = true): unknown {
  if (typeof value === 'string') return value === from ? to : value;
  if (typeof value === 'number') return String(value) === from && String(Number(to)) === to ? Number(to) : value;
  if (Array.isArray(value)) return value.map((v) => renamed(v, from, to, false));
  if (value && typeof value === 'object') {
    const out: Item = {};
    for (const [k, v] of Object.entries(value as Item)) out[k] = top && k.startsWith('_') ? v : renamed(v, from, to, false);
    return out;
  }
  return value;
}

/** The record as it should read in the new holon. */
function carried(hs: HoloSphere, item: Item, from: string, to: string): Item {
  // A pointer says only where a record lives; one at the old holon's own
  // record follows the record.
  if (hs.isHologram(item)) {
    const out = clean(item);
    const soul = hs.parseSoulPath(out.soul);
    if (soul && String(soul.holon) === from) out.soul = `${soul.appname}/${to}/${soul.lens}/${soul.key}`;
    return out;
  }
  // Anything else names the new id wherever it named the old one — its own
  // key included (settings is keyed by the holon's id).
  return renamed(clean(item), from, to) as Item;
}

/**
 * Carry `from` on as `to` (see the header). The caller must be an admin of
 * the old holon; the new one is founded here when nobody has, and must be
 * this key's to administer when somebody did. Safe to run again — after a
 * crash, or later to bring across what was written to the old id meanwhile.
 */
export async function succeedHolon(hs: HoloSphere, input: SuccessionInput): Promise<SuccessionResult> {
  const from = String(input.from ?? '').trim();
  const to = String(input.to ?? '').trim();
  if (!isMovableId(from) || !isMovableId(to)) return { ok: false, refused: 'not-holon' };
  if (from === to) return { ok: false, refused: 'same' };
  const key = me(hs);
  if (!key || !hs.signingEnabled) return { ok: false, refused: 'not-admin' };
  const host = hs as CopyHost & Host;

  if ((await myHolonRole(hs, from)) !== 'admin') return { ok: false, refused: 'not-admin' };
  const already = await readSuccessor(hs, from);
  if (already && already !== to) return { ok: false, refused: 'moved' };
  if ((await resolveHolon(hs, to)) === from) return { ok: false, refused: 'cycle' };

  // 1. The roster. `getMembers` reads the relays first, so an id someone
  //    else founded is seen before anything is signed for it.
  const roster = new Map<string, Role>();
  for (const [pub, role] of await hs.getMembers(from)) if (pub !== key) roster.set(pub, role === 'admin' ? 'admin' : 'member');
  const existing = await hs.getMembers(to);
  if (existing.size && existing.get(key) !== 'admin') return { ok: false, refused: 'taken' };
  const dry = input.dryRun === true;
  let synced: { founded: boolean; added: string[]; changed: string[] };
  if (dry) {
    synced = { founded: !existing.size, added: [...roster.keys()].filter((k) => !existing.has(k)), changed: [...roster].filter(([k, r]) => existing.has(k) && existing.get(k) !== r).map(([k]) => k) };
  } else {
    synced = await syncMembersLog(hs, to, roster, { prune: false });
    host._readAuthority?.invalidate?.(to);
    if ((await myHolonRole(hs, to)) !== 'admin') return { ok: false, refused: 'taken' };
  }

  const report: SuccessionReport = {
    ok: true,
    from,
    to,
    founded: synced.founded,
    seated: [...synced.added, ...synced.changed],
    copied: {},
    kept: 0,
    conflicts: [],
    skipped: [],
    sealed: [],
    repointed: 0,
    failed: [],
  };
  const anchor = actorsFromMembersLog(await readMembersLog(hs, to))?.genesis ?? key;

  // 2. The records, lens by lens.
  for (const lens of await lensesOf(host, from, input.lenses ?? [])) {
    const reason = skipReason(host, from, lens);
    if (reason) {
      report.skipped.push({ lens, reason });
      continue;
    }
    const theirs = new Map<string, Item>();
    for (const item of await rawAll(hs, to, lens, true)) theirs.set(String(item.id), item);

    for (const source of await rawAll(hs, from, lens, false)) {
      const sourceId = String(source.id);
      if (hs.isPrivate(from, lens, sourceId)) {
        report.sealed.push({ lens, id: sourceId });
        continue;
      }
      let next = carried(hs, source, from, to);
      const id = String(next.id);
      const held = theirs.get(id);
      if (held?._deleted === true) {
        report.kept++;
        continue;
      }
      if (lens === SETTINGS_LENS && id === to) {
        // The holon's own settings: one side fills the other's gaps, and the
        // record always names the new id and the key that speaks for it.
        const mine = held ? clean(held) : {};
        next = { ...(input.overwrite ? { ...mine, ...next } : { ...next, ...mine }), id: to, holonPubkey: anchor };
      } else if (held && said(held) !== said(next) && !input.overwrite) {
        report.conflicts.push({ lens, id });
        continue;
      }
      if (held && said(held) === said(next)) {
        report.kept++;
        continue;
      }
      if (dry) {
        report.copied[lens] = (report.copied[lens] ?? 0) + 1;
        continue;
      }
      try {
        // A federated full copy keeps its origin stamp: it is still a
        // partner's record, not one this holon wrote.
        await hs.put(to, lens, next, next._federation && !hs.isHologram(next) ? { preserveFederationMeta: true } : {});
        report.copied[lens] = (report.copied[lens] ?? 0) + 1;
      } catch (err) {
        report.failed.push({ lens, id, error: err instanceof Error ? err.message : String(err) });
        continue;
      }
      if (ROSTER_LENSES.includes(lens) && !hs.isHologram(next)) report.repointed += await repoint(hs, lens, id, next, from, to);
    }
  }

  if (dry) return report;
  // 3. The pair, last: the old id points here only once there is something to find.
  const at = input.now ?? Date.now();
  const predecessorId = `${PREDECESSOR_PREFIX}${from}`;
  if (!(await adminRecord(hs, to, predecessorId))) await hs.put(to, SUCCESSION_LENS, { id: predecessorId, holon: from, by: key, at } satisfies SuccessionRecord);
  if (!(await adminRecord(hs, from, SUCCESSOR_ID))) await hs.put(from, SUCCESSION_LENS, { id: SUCCESSOR_ID, holon: to, by: key, at } satisfies SuccessionRecord);
  host._readAuthority?.invalidate?.(from);
  host._readAuthority?.invalidate?.(to);
  return report;
}

/**
 * Point each named person's own-holon mirror of a card at the card's new
 * address. Only a pointer at exactly the old card is touched: a card of
 * their own under the same id, or no mirror at all, is left as it is (the
 * roster mirror writes a missing one on the copy itself).
 */
async function repoint(hs: HoloSphere, lens: string, id: string, card: Item, from: string, to: string): Promise<number> {
  let count = 0;
  for (const person of rosterOf(card as unknown as Quest)) {
    const home = personalHolonOf({ id: person.id as never });
    if (!home || home === from || home === to) continue;
    try {
      const claim = (await hs.get(home, lens, id, null, { resolveHolograms: false })) as Item | null;
      if (!claim || !hs.isHologram(claim)) continue;
      const soul = hs.parseSoulPath(claim.soul);
      if (!soul || String(soul.holon) !== from || soul.lens !== lens || String(soul.key) !== id) continue;
      await hs.put(home, lens, hs.createHologram(to, lens, { id }));
      count++;
    } catch {
      /* their holon is unreadable from here: the mirror stays where it was */
    }
  }
  return count;
}
