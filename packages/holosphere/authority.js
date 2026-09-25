// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Who speaks for a holon — read from signed envelopes only.
//
// A holon's trust anchor is, in order: the id itself when it is a pubkey (a
// personal holon IS its key); the genesis author of its signed `_members`
// log; else the EARLIEST `settings` envelope that declares a `holonPubkey`
// and is signed by that very key (self-consistent, first-seen). The current
// settings record is never consulted for this: it is last-writer-wins, so
// whoever writes last would otherwise pick who receives the holon's keys.

import { eventToItem } from './nostr-events.js';
import { buildTimeline } from './signing.js';

export const MEMBERS_LENS = '_members';
export const SETTINGS_LENS = 'settings';
const HEX64 = /^[0-9a-f]{64}$/i;

/** Is this holon id a pubkey (a personal holon)? */
export function isPubkeyHolon(holon) {
    return typeof holon === 'string' && HEX64.test(holon);
}

const oldestFirst = (a, b) => (a.created_at - b.created_at) || (a.id < b.id ? -1 : 1);
const newestFirst = (a, b) => (b.created_at - a.created_at) || (a.id < b.id ? 1 : -1);

/** Every signed `_members` envelope the store holds for a holon. */
export function membersEvents(store, holon) {
    const h = String(holon);
    const out = [];
    for (const id of store.listEventIds(h, MEMBERS_LENS)) out.push(...store.getEvents(h, MEMBERS_LENS, id));
    return out;
}

/** The as-of-time membership fold of a holon's `_members` log. */
export function membersTimeline(store, holon, pinnedGenesis) {
    return buildTimeline(membersEvents(store, holon), pinnedGenesis || undefined);
}

/** The genesis author of the `_members` log, or null when nobody founded the holon. */
export function membersGenesis(store, holon) {
    return membersTimeline(store, holon).genesisPub;
}

/**
 * The earliest self-signed `holonPubkey` declaration in `settings`: the
 * author of that envelope is the key it declares. Null when no envelope is
 * self-consistent.
 */
export function settingsAnchor(store, holon) {
    const h = String(holon);
    const events = store.getEvents(h, SETTINGS_LENS, h).slice().sort(oldestFirst);
    for (const e of events) {
        const item = eventToItem(e);
        const declared = item && typeof item.holonPubkey === 'string' ? item.holonPubkey.toLowerCase() : null;
        if (declared && declared === String(e.pubkey).toLowerCase()) return declared;
    }
    return null;
}

/** The key that speaks for a holon, or null when nothing signed says who does. */
export function holonAnchor(store, holon) {
    const h = String(holon ?? '');
    if (!h) return null;
    if (isPubkeyHolon(h)) return h.toLowerCase();
    return membersGenesis(store, h) || settingsAnchor(store, h);
}

/** A holon's newest envelope at (lens, id) signed by `author`, decoded; null when none. */
export function itemByAuthor(store, holon, lens, id, author) {
    const want = String(author).toLowerCase();
    const events = store.getEvents(String(holon), lens, String(id)).filter((e) => String(e.pubkey).toLowerCase() === want).sort(newestFirst);
    return events.length ? eventToItem(events[0]) : null;
}

/** Every item of a lens as signed by `author` (newest claim per id), tombstones dropped. */
export function itemsByAuthor(store, holon, lens, author) {
    const out = [];
    for (const id of store.listEventIds(String(holon), lens)) {
        const item = itemByAuthor(store, holon, lens, id, author);
        if (item && item._deleted !== true) out.push(item);
    }
    return out;
}

/**
 * The default answer to "may this key hand out (or edit under) keys of this
 * holon": the anchor, the holon itself, or a current member of its log.
 */
export function isAcceptedSender(store, holon, sender) {
    if (!sender) return false;
    const s = String(sender).toLowerCase();
    const h = String(holon ?? '');
    if (!h) return false;
    if (s === h.toLowerCase()) return true;
    const anchor = holonAnchor(store, h);
    if (anchor && anchor === s) return true;
    return membersTimeline(store, h).isAuthorizedAt(s, Number.MAX_SAFE_INTEGER);
}

export default { isPubkeyHolon, membersEvents, membersTimeline, membersGenesis, settingsAnchor, holonAnchor, itemByAuthor, itemsByAuthor, isAcceptedSender };
