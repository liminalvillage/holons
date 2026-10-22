// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Append-only log operations: append / appendSigned / getLog / subscribeLog.
//
// A log lens is carried on a REGULAR Nostr kind (HOLOSPHERE_LOG_KIND, 1808),
// never a replaceable one. Each entry is its own record, addressed by its
// event id, so the store's one ordering rule (`store/lww.js`) never sees a
// second claim at the same address: nothing supersedes, nothing tombstones,
// every verified entry is kept. What an entry MEANS — whether its author is
// an accepted signer, whether it is attested, what state the log folds into —
// is not decided here: the reader reduces the log (`@holons/core/protocol`).
// This layer only stores, verifies and orders.

import { buildLogEvent, logRefs, HOLOSPHERE_LOG_KIND } from './nostr-events.js';
import { GLOBAL_HOLON } from './store/address.js';
import { isTombstone } from './store/store.js';

const normHolon = (h) => (h === null || h === undefined || h === '' ? null : h);
const wireHolon = (h) => (normHolon(h) === null ? GLOBAL_HOLON : String(h));

/** Oldest first; ties by smaller event id (the mirror of `store/lww.js`). */
export const oldestFirst = (a, b) => (a.created_at - b.created_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function assertAppendLens(holo, lens, op) {
    if (!holo?.store?.wire?.isAppend?.(lens)) {
        throw new Error(`${op}: lens '${lens}' is not an append-only lens — register it first (appendLenses / registerAppendLens)`);
    }
}

/** A log entry as readers see it: the verified envelope plus its decoded body. */
export function entryOf(event, item) {
    return {
        id: event.id,
        pubkey: event.pubkey,
        created_at: event.created_at,
        kind: event.kind,
        refs: logRefs(event),
        item,
        event,
    };
}

/**
 * The `created_at` an author's next entry must carry to sort after every
 * entry they already have in this log: now, or one past their latest when
 * the clock has not moved. Same-second entries otherwise order by event id —
 * deterministic, but not the order they were appended in — and a chain of
 * `prev` refs should never run backwards in time.
 */
function nextLogCreatedAt(holo, holon, lens, pubkey) {
    let latest = 0;
    for (const rec of holo.store.list(normHolon(holon), lens)) {
        if (rec.pubkey === pubkey && rec.created_at > latest) latest = rec.created_at;
    }
    return Math.max(Math.floor(Date.now() / 1000), latest + 1);
}

/**
 * Append a signed entry to a log lens with the instance key. Applied locally
 * first (verified like any other event), then published; returns the signed
 * event. `refs` is `{ prev, basis, attests, disputes }` (ids or id arrays) or
 * an array of `{ id, marker }`.
 */
export async function append(holo, holon, lens, item, { refs, created_at } = {}) {
    assertAppendLens(holo, lens, 'append');
    if (!holo._privateKey) throw new Error('append: a private key is required to sign a log entry');
    const event = buildLogEvent({
        holon: wireHolon(holon),
        lens,
        item,
        sk: holo._privateKey,
        created_at: created_at ?? nextLogCreatedAt(holo, holon, lens, holo.currentPubkey),
        refs,
        extraTags: [['n', holo.appname]],
    });
    const r = holo.store.apply(event, { origin: 'local' });
    if (!r.applied && r.reason !== 'seen') throw new Error(`append: log entry was not applied (${r.reason})`);
    holo._relayTransport?.publishEvents([event]);
    return event;
}

/**
 * Apply and publish a log entry signed elsewhere (a host signing as one of
 * its members, an event received out of band). The event must be a log kind
 * in this namespace addressed to a registered append lens; its signature is
 * verified on apply like every other event.
 */
export async function appendSigned(holo, event) {
    if (!event || event.kind !== HOLOSPHERE_LOG_KIND) throw new Error(`appendSigned: not a log event (kind ${event?.kind})`);
    const claims = holo.store.wire.decode(event);
    if (!claims || !claims.length) throw new Error('appendSigned: event does not decode to a registered append lens');
    const r = holo.store.apply(event, { origin: 'local' });
    if (!r.applied && r.reason !== 'seen') throw new Error(`appendSigned: log entry was not applied (${r.reason})`);
    if (r.applied) holo._relayTransport?.publishEvents([event]);
    return r;
}

/**
 * Every verified entry of a log lens, oldest first, optionally narrowed by
 * time or author. Envelopes come from the store's events table (verified on
 * apply), so a tampered record slot cannot change what a reader folds.
 */
export function getLog(holo, holon, lens, { since, until, authors } = {}) {
    assertAppendLens(holo, lens, 'getLog');
    const wantAuthors = authors ? new Set(authors) : null;
    const out = [];
    for (const rec of holo.store.list(normHolon(holon), lens)) {
        const event = rec.eventId ? holo.store.events.get(rec.eventId) : null;
        if (!event) continue; // an unsigned slot is not a log entry
        if (since !== undefined && event.created_at < since) continue;
        if (until !== undefined && event.created_at > until) continue;
        if (wantAuthors && !wantAuthors.has(event.pubkey)) continue;
        out.push(entryOf(event, rec.item));
    }
    return out.sort(oldestFirst);
}

/**
 * Watch a log lens: the current entries replay (oldest first) and every new
 * entry is delivered as it lands. Returns the unsubscribe function.
 */
export function subscribeLog(holo, holon, lens, cb, { replay = true } = {}) {
    assertAppendLens(holo, lens, 'subscribeLog');
    if (typeof cb !== 'function') throw new Error('subscribeLog: callback required');
    const h = normHolon(holon);
    if (replay) {
        // Deliver the ordered replay ourselves — the store replays in index
        // order, which is arrival order, not log order.
        let live = [];
        let replayed = false;
        const off = holo.store.watch(h, lens, (item, id, meta) => {
            if (meta?.replay || isTombstone(item)) return;
            const event = holo.store.events.get(meta?.eventId);
            if (!event) return;
            const entry = entryOf(event, item);
            if (!replayed) live.push(entry);
            else cb(entry);
        }, { replay: false });
        queueMicrotask(() => {
            const seen = new Set();
            for (const entry of getLog(holo, h, lens)) { seen.add(entry.id); cb(entry); }
            replayed = true;
            for (const entry of live) if (!seen.has(entry.id)) cb(entry);
            live = [];
        });
        return off;
    }
    return holo.store.watch(h, lens, (item, id, meta) => {
        if (meta?.replay || isTombstone(item)) return;
        const event = holo.store.events.get(meta?.eventId);
        if (event) cb(entryOf(event, item));
    }, { replay: false });
}
