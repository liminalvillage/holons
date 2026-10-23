// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Field clocks: last-writer-wins per FIELD instead of per record.
//
// A replaceable envelope carries the whole item, so with record-level LWW the
// newest envelope wins every field — including the ones its author never
// touched. A device holding a stale copy that toggles "join" re-asserts the
// stale date, title and `_deleted` flag along with it, and silently reverts
// whatever anyone else changed in between (the 2026-10-22 Lunation 84 case: a
// reschedule undone by a teammate's join a few minutes later).
//
// So every signed write stamps `_clock: { field: seconds }` — the time each
// field last CHANGED, as far as the writer knew:
//
//   • a field equal to the writer's base keeps the base's stamp;
//   • a field the writer changed gets the write's own time — unless the copy
//     the writer edited (its own `_clock`) predates the base's stamp for that
//     field: then the writer was looking at an outdated value, and the field
//     keeps the older stamp and loses to the newer one.
//
// Readers fold every claim at an address field by field: the highest stamp
// wins, ties by the newer envelope. A claim without `_clock` (a legacy writer,
// a bare tombstone, a hologram pointer, a locked stub) asserts EVERY field —
// present or absent — at its own `created_at`, which is exactly record-level
// LWW. A set of claims with no clock at all therefore folds to the newest
// item, unchanged.
//
// A clock describes ONE address, and says which (`@`). An item read through a
// hologram, or copied from another holon, carries the clock of the place it
// was read from; written somewhere else, that clock says nothing about what
// the writer knew of the destination, so it is ignored there.
//
// Granularity is the top-level field. Two people changing the same field
// concurrently still resolve last-writer-wins on that field.

import { wins } from './lww.js';

/** The item field that carries the clock. */
export const CLOCK_FIELD = '_clock';

/** The clock entry naming the address it describes. */
const AT = '@';

/** Fields that are never clocked: the address and the clock itself. */
const UNCLOCKED = new Set(['id', CLOCK_FIELD]);

/** The `@` of a clock for (holon, lens, id); a global's holon is empty. */
export function clockAddress(holon, lens, id) {
    return `${holon ?? ''}/${lens}/${id}`;
}

const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);

/** Does this item carry a field clock? */
export function hasClock(item) {
    const c = item && typeof item === 'object' ? item[CLOCK_FIELD] : null;
    return !!c && typeof c === 'object' && !Array.isArray(c);
}

/** JSON with sorted object keys, so equal values compare equal whatever their key order. */
function canonical(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}

/** Do two items hold the same value for a field (absent equals absent)? */
function sameField(a, b, k) {
    const ha = own(a, k);
    const hb = own(b, k);
    if (ha !== hb) return false;
    return !ha || canonical(a[k]) === canonical(b[k]);
}

/** Are two items equal field by field (clock included)? */
export function sameItem(a, b) {
    return canonical(a) === canonical(b);
}

const stampOf = (clock, k) => (Number.isFinite(clock?.[k]) ? clock[k] : 0);

/** The field names a clock stamps (its `@` is not a field). */
const clockedKeys = (clock) => Object.keys(clock || {}).filter((k) => k !== AT);

/**
 * The clock for a write of `payload` over `base`.
 *
 * @param {object} payload            the item being written (its own `_clock`, if any, is the writer's view)
 * @param {{item: object, created_at: number}|null|undefined} base  the record currently at the address
 * @param {number} at                 the write's `created_at`
 * @param {string} address            `clockAddress(...)` of the address written
 * @param {object} [opts]
 * @param {Set<string>} [opts.own]    fields whose current value the writer's own key set: a writer is
 *                                    never stale against itself, so its change to one is a change
 *                                    even from an older copy (an edit sheet left open across two saves)
 * @returns {Record<string, number|string>}
 */
export function stampClock(payload, base, at, address, { own: ownFields = null } = {}) {
    const bItem = base?.item && typeof base.item === 'object' ? base.item : null;
    const bClock = hasClock(bItem) ? bItem[CLOCK_FIELD] : null;
    // The writer's own view counts only if it was read from this address.
    const pClock = hasClock(payload) && payload[CLOCK_FIELD][AT] === address ? payload[CLOCK_FIELD] : null;
    // A base without a clock asserted every field at its own time.
    const baseStamp = (k) => (!bItem ? 0 : bClock ? stampOf(bClock, k) : base.created_at || 0);

    const keys = new Set([
        ...Object.keys(payload || {}),
        ...Object.keys(bItem || {}),
        ...clockedKeys(bClock),
        ...clockedKeys(pClock),
    ]);
    const clock = { [AT]: address };
    for (const k of keys) {
        if (UNCLOCKED.has(k)) continue;
        const bs = baseStamp(k);
        let stamp;
        if (sameField(payload, bItem, k)) {
            stamp = bs;
        } else {
            // What the writer's copy knew of this field. A payload without a
            // clock was built from the base itself (or from nothing): its
            // change is a change.
            const ps = pClock && !ownFields?.has(k) ? stampOf(pClock, k) : bs;
            stamp = ps >= bs ? at : ps;
        }
        if (stamp > 0) clock[k] = stamp;
    }
    return clock;
}

/** The stamp a claim asserts for a field, or null when it says nothing about it. */
function claimStamp(claim, k) {
    if (hasClock(claim.item)) {
        const s = k === AT ? null : claim.item[CLOCK_FIELD][k];
        // The clock is the author's word; `created_at` is what they signed.
        // A stamp past it would let one write outrank every later edit of a
        // field, so it counts as no newer than the write itself.
        return Number.isFinite(s) ? Math.min(s, claim.created_at) : null;
    }
    return claim.created_at;
}

const newer = (a, b) => wins(
    { created_at: a.created_at, eventId: a.eventId },
    { created_at: b.created_at, eventId: b.eventId },
);

/** The newest claim of a list. */
function newestOf(list) {
    let newest = list[0];
    for (const c of list) if (newer(c, newest)) newest = c;
    return newest;
}

/**
 * Which claim wins each field, and at what stamp: `Map<field, {claim, stamp}>`.
 * Without any clock every field goes to the newest claim.
 */
function fieldWinners(list) {
    const newest = newestOf(list);
    // Newest item's own key order first, so a fold reads like the item it
    // mostly is.
    const keys = new Set(Object.keys(newest.item));
    for (const c of list) {
        for (const k of Object.keys(c.item)) keys.add(k);
        if (hasClock(c.item)) for (const k of clockedKeys(c.item[CLOCK_FIELD])) keys.add(k);
    }
    const winners = new Map();
    for (const k of keys) {
        if (UNCLOCKED.has(k)) continue;
        let best = null;
        let bestStamp = 0;
        for (const c of list) {
            const s = claimStamp(c, k);
            if (s === null) continue;
            if (!best || s > bestStamp || (s === bestStamp && newer(c, best))) { best = c; bestStamp = s; }
        }
        if (best) winners.set(k, { claim: best, stamp: bestStamp });
    }
    return winners;
}

const usable = (claims) => (claims || []).filter((c) => c && c.item && typeof c.item === 'object');

/**
 * Fold the claims at one address into the current item.
 *
 * @param {Array<{item: object, created_at: number, eventId?: string}>} claims
 * @param {string} [address]  `clockAddress(...)` of the address; defaults to the claims' own
 * @returns {object|null} the folded item (`null` for no claims)
 */
export function foldClaims(claims, address) {
    const list = usable(claims);
    if (!list.length) return null;
    const newest = newestOf(list);
    if (!list.some((c) => hasClock(c.item))) return newest.item;

    const at = address ?? list.find((c) => hasClock(c.item))?.item[CLOCK_FIELD][AT];
    const out = {};
    const clock = at === undefined ? {} : { [AT]: at };
    for (const [k, { claim, stamp }] of fieldWinners(list)) {
        if (own(claim.item, k)) out[k] = claim.item[k];
        if (stamp > 0) clock[k] = stamp;   // absences too: a later writer needs to know when
    }
    return { id: newest.item.id, ...out, [CLOCK_FIELD]: clock };
}

/**
 * The fields whose current value `pubkey` set, among claims that carry their
 * author (`{ item, created_at, eventId, pubkey }`).
 */
export function fieldsBy(claims, pubkey) {
    const list = usable(claims);
    const out = new Set();
    if (!list.length || !pubkey) return out;
    for (const [k, { claim }] of fieldWinners(list)) if (claim.pubkey === pubkey) out.add(k);
    return out;
}
