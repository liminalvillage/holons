// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The local store: an event-sourced mirror of what the relays hold, plus the
// few things that never reach a relay (raw/local-only writes, private lenses,
// sync cursors). Everything lives in memory; an adapter makes it durable.
//
// Tables
//   records   addr → { addr, holon, lens, id, item, created_at, pubkey, eventId, origin }
//             The CURRENT value at every address. Tombstones (`item._deleted`)
//             are records too — they are how a delete travels and how enforce
//             mode tells "deleted" from "never existed".
//   events    id → signed kind-30078 envelope; only each author's LATEST claim
//             per address is kept (NIP-33 semantics). This replaces the old
//             `_events` sidecar: signing reads its envelopes from here.
//   private   NIP-44 ciphertext of password lenses (see private.js).
//   cursors   lens key → { since, syncedAt }: how far a lens has been synced.
//   outbox    id → signed event (any kind) this instance published but no
//             relay has acknowledged yet. The transport replays it until one
//             does, so a write made offline still travels once the network is
//             back — and survives a reload in between. One entry per
//             replaceable coordinate: a newer write to the same address drops
//             the unsent older one (the relay would keep only the newest).
//   backlinks source soul → Set<pointer soul>: derived from the records that
//             are hologram pointers; rebuilt on open, maintained on write.
//             This is the `_holograms` cascade index, no longer a sub-node.
//
// Ordering: `apply(event)` is the ONE place last-writer-wins is decided
// (lww.js). Everything else is bookkeeping and the change feed. Once a claim
// at an address carries a field clock, the record is the field-by-field fold
// of every author's claim there (clock.js) rather than the newest envelope.

import { HOLOSPHERE_KIND, verifyEvent, eventToItem, tag } from '../nostr-events.js';
import { isHologram } from '../hologram.js';
import {
    GLOBAL_HOLON, CAPABILITIES_HOLON, holonKey, holonFromKey, lensKey, cursorKey, addr, lensKeyOfAddr, soulOf,
} from './address.js';
import { wins, newestFirst } from './lww.js';
import { hasClock, foldClaims, fieldsBy, sameItem, clockAddress } from './clock.js';
import { createWireRegistry, decodeEvent } from './wire.js';
import { privateKeyOf, privateLensPrefix } from './private.js';
import { isLocked } from './sealed.js';

const nowSec = () => Math.floor(Date.now() / 1000);

/**
 * How far ahead of this clock a RECEIVED event may be dated: strfry's own
 * default (`rejectEventsNewerThanSeconds`). `created_at` decides last-writer-
 * wins and caps every field-clock stamp, so an event dated next year would
 * outrank every honest write until then. Our own writes are exempt — a burst
 * of same-second writes legitimately runs ahead (see `nextCreatedAt`).
 */
export const MAX_FUTURE_SKEW = 900;

/** Is this item a tombstone? */
export function isTombstone(item) {
    return !!item && typeof item === 'object' && item._deleted === true;
}

export { isLocked };

/**
 * The slot an author's claim occupies at an address.
 *
 * Keyed by pubkey AND kind, because one record can be encoded two ways on the
 * wire — the legacy kind-30078 envelope and a standard kind — and NIP-33 makes
 * those two independent replaceable slots on the relay. Keyed by pubkey alone
 * they collided in one slot here, so the first standard write by our own key
 * evicted the legacy envelope: the record survived, but `getEvents`,
 * `exportEvents`, `nextCreatedAt` and enforce mode all read envelopes, not
 * records.
 */
function claimKey(event) {
    return `${event.pubkey}|${event.kind}`;
}



export { decodeEvent };

/**
 * The NIP-01 replaceable coordinate of an event, or null when every copy is
 * kept: `kind|pubkey` for kinds 0, 3 and 10000–19999, `kind|pubkey|d` for
 * 30000–39999.
 */
export function replaceableCoordinate(event) {
    const k = event.kind;
    if (k === 0 || k === 3 || (k >= 10000 && k < 20000)) return `${k}|${event.pubkey}`;
    if (k >= 30000 && k < 40000) return `${k}|${event.pubkey}|${tag(event, 'd') ?? ''}`;
    return null;
}

export class Store {
    /**
     * @param {object} opts
     * @param {string} opts.appName          namespace this store mirrors (checked against the `n` tag)
     * @param {object|Function} opts.adapter  a StoreAdapter, or a thunk resolving to one
     * @param {number} [opts.kind]           legacy envelope kind (default 30078)
     * @param {object} [opts.wire]           wire registry; defaults to the legacy envelope alone
     * @param {Function} [opts.unseal]       opens sealed envelopes (see sealed.js); installable later via `setUnseal`
     * @param {number} [opts.compactAfter]   ops appended before the log is compacted (default 50000)
     * @param {number} [opts.maxFutureSkew]  seconds a received event may be dated ahead of this clock (default 900)
     */
    constructor({ appName, adapter, kind = HOLOSPHERE_KIND, wire, unseal, compactAfter = 50000, maxFutureSkew = MAX_FUTURE_SKEW } = {}) {
        if (!appName) throw new Error('store: appName is required');
        this.appName = String(appName);
        this.kind = kind;
        // Which kinds this store consumes and how each decodes to an address.
        // Seeded with the legacy envelope alone, so a store nobody configured
        // behaves exactly as it always did.
        this.wire = wire || createWireRegistry({ legacyKind: kind });
        if (typeof unseal === 'function') this.wire.setUnseal?.(unseal);
        this.compactAfter = compactAfter;
        this.maxFutureSkew = maxFutureSkew;

        this._adapterInit = adapter;
        this.adapter = null;
        this._opened = false;
        this._closed = false;

        this.records = new Map();
        this.events = new Map();
        this.eventsByAddr = new Map();   // addr → Map<`pubkey|kind`, eventId>
        this.eventIdsByLens = new Map(); // lens key → Set<id>
        this.private = new Map();
        this.cursors = new Map();
        this.outbox = new Map();         // event id → event awaiting a relay OK
        this.backlinks = new Map();      // soul → Set<soul>
        this.lensIndex = new Map();      // lens key → Map<id, record>
        this.holonIndex = new Map();     // holon key → Set<lens>
        this.watchers = new Map();       // lens key → Set<entry>
        this._decoded = new WeakMap();   // event → its decoded claims (see _decode)

        this._ops = [];
        this._flushQueued = false;
        this._writeChain = Promise.resolve();
        this._opsSinceCompact = 0;
        this._driftWarned = new Set();
    }

    // ------------------------------------------------------------------ lifecycle

    /** Open the adapter and hydrate every table from it. Idempotent. */
    async open() {
        if (this._opened) return this;
        if (this._closed) throw new Error('store: closed');
        const init = this._adapterInit;
        this.adapter = typeof init === 'function' ? await init() : init;
        if (!this.adapter) throw new Error('store: an adapter is required');
        const snapshot = await this.adapter.open();
        if (snapshot) {
            for (const rec of snapshot.records || []) {
                if (rec && rec.addr) this._setRecord(rec, { persist: false, emit: false });
            }
            for (const evt of snapshot.events || []) this._indexEvent(evt);
            for (const [k, v] of snapshot.private || []) this.private.set(k, v);
            for (const [k, v] of snapshot.cursors || []) this.cursors.set(k, v);
            for (const evt of snapshot.outbox || []) if (evt && evt.id) this.outbox.set(evt.id, evt);
        }
        this._opened = true;
        return this;
    }

    /** Wait for every queued persistence op to reach the adapter. */
    async flush() {
        if (this._ops.length) this._flushNow();
        await this._writeChain;
    }

    /** Rewrite the adapter's durable state from the in-memory tables. */
    async compact() {
        await this.flush();
        this._opsSinceCompact = 0;
        if (this.adapter) await this.adapter.snapshot(this.snapshot());
    }

    /** Drop everything, in memory and in the adapter. */
    async clear() {
        this.records.clear(); this.events.clear(); this.eventsByAddr.clear(); this.eventIdsByLens.clear();
        this.private.clear(); this.cursors.clear(); this.outbox.clear(); this.backlinks.clear();
        this.lensIndex.clear(); this.holonIndex.clear();
        this._ops = [];
        if (this.adapter) await this.adapter.clear();
    }

    async close() {
        if (this._closed) return;
        this._closed = true;
        await this.flush();
        this.watchers.clear();
        if (this.adapter) await this.adapter.close();
    }

    /** Full persistence snapshot of the in-memory tables. */
    snapshot() {
        return {
            records: Array.from(this.records.values()),
            events: Array.from(this.events.values()),
            private: Array.from(this.private.entries()),
            cursors: Array.from(this.cursors.entries()),
            outbox: Array.from(this.outbox.values()),
        };
    }

    stats() {
        return {
            records: this.records.size,
            events: this.events.size,
            private: this.private.size,
            cursors: this.cursors.size,
            outbox: this.outbox.size,
            lenses: this.lensIndex.size,
            holons: this.listHolons().length,
            watchers: Array.from(this.watchers.values()).reduce((n, s) => n + s.size, 0),
            adapter: this.adapter?.kind || null,
        };
    }

    // ------------------------------------------------------------------ writes

    /**
     * Apply a signed event. Returns `{ applied, reason, record, records }`;
     * `reason` is one of seen | kind | foreign | malformed | future | invalid |
     * stale when nothing was applied. `future`: a received (non-local) event
     * dated more than `maxFutureSkew` seconds ahead of this clock.
     *
     * An event may claim SEVERAL addresses — a NIP-09 kind 5 retracts every
     * coordinate in its `a` tags — so the address work runs per claim and
     * `applied` means "at least one claim landed". `record` stays the first
     * one, which is what every existing caller reads.
     */
    apply(event, { origin = 'remote', verify = true } = {}) {
        if (!event || typeof event !== 'object' || !event.id) return { applied: false, reason: 'malformed' };
        if (!this.wire.accepts(event.kind)) return { applied: false, reason: 'kind' };
        const n = tag(event, 'n');
        if (n !== undefined && n !== this.appName) return { applied: false, reason: 'foreign' };
        const claims = this.wire.decode(event);
        if (!claims) return { applied: false, reason: 'malformed' };

        const first = this.records.get(addr(claims[0].holon, claims[0].lens, claims[0].id));
        if (this.events.has(event.id)) return { applied: false, reason: 'seen', record: first };
        if (origin !== 'local' && Number.isFinite(this.maxFutureSkew)
            && event.created_at > nowSec() + this.maxFutureSkew) return { applied: false, reason: 'future' };
        if (verify && !verifyEvent(event)) return { applied: false, reason: 'invalid' };

        const records = [];
        let staleAt = 0;
        for (const decoded of claims) {
            const a = addr(decoded.holon, decoded.lens, decoded.id);
            const current = this.records.get(a);
            this._storeEvent(a, decoded, event);
            const folded = this._foldAt(a, current);
            if (folded) {
                if (!folded.changed) { staleAt++; continue; }
                const record = { ...folded.record, origin };
                this._setRecord(record);
                records.push(record);
                continue;
            }
            if (!wins({ created_at: event.created_at, eventId: event.id }, current)) {
                staleAt++;
                continue;
            }
            const record = {
                addr: a,
                holon: decoded.holon,
                lens: decoded.lens,
                id: decoded.id,
                item: decoded.item,
                created_at: event.created_at,
                pubkey: event.pubkey,
                eventId: event.id,
                origin,
            };
            this._setRecord(record);
            records.push(record);
        }
        if (!records.length) return { applied: false, reason: staleAt ? 'stale' : 'malformed', record: first };
        return { applied: true, record: records[0], records };
    }

    /**
     * Write an unsigned, local-only value. It always becomes current (its
     * timestamp is bumped past the current record) but loses ties against any
     * signed event that later arrives with the same second.
     */
    putRaw(holon, lens, id, item, { origin = 'raw' } = {}) {
        if (!item || typeof item !== 'object') throw new Error('store.putRaw: item must be an object');
        const a = addr(holon, lens, id);
        const record = {
            addr: a,
            holon: holon === undefined || holon === '' ? null : holon,
            lens: String(lens),
            id: String(id),
            item,
            created_at: this.nextCreatedAt(holon, lens, id),
            pubkey: null,
            eventId: '',
            origin,
        };
        this._setRecord(record);
        return record;
    }

    /**
     * The `created_at` a new write at this address must carry to become
     * current: now, or one past whatever is current when the clock has not
     * moved. Relays keep the first of two equal timestamps, so a same-second
     * update MUST be strictly newer.
     */
    nextCreatedAt(holon, lens, id) {
        const a = addr(holon, lens, id);
        let latest = this.records.get(a)?.created_at ?? 0;
        const byAuthor = this.eventsByAddr.get(a);
        if (byAuthor) {
            for (const eid of byAuthor.values()) {
                const e = this.events.get(eid);
                if (e && e.created_at > latest) latest = e.created_at;
            }
        }
        const now = nowSec();
        const next = Math.max(now, latest + 1);
        if (next - now > 300 && !this._driftWarned.has(a)) {
            this._driftWarned.add(a);
            console.warn(`[holosphere/store] ${a.replace(/\u001f/g, '/')} is ${next - now}s ahead of the clock (many same-second writes); relays reject events far in the future`);
        }
        return next;
    }

    // ------------------------------------------------------------------ reads

    get(holon, lens, id) {
        return this.records.get(addr(holon, lens, id));
    }

    /**
     * The current records of a lens. Tombstones and locked stubs (sealed
     * records this instance holds no key for) are hidden unless asked for —
     * both are records that mean "nothing to show here".
     */
    list(holon, lens, { includeDeleted = false, includeLocked = false } = {}) {
        const idx = this.lensIndex.get(lensKey(holon, lens));
        if (!idx) return [];
        const out = [];
        for (const rec of idx.values()) {
            if (!includeDeleted && isTombstone(rec.item)) continue;
            if (!includeLocked && isLocked(rec.item)) continue;
            out.push(rec);
        }
        return out;
    }

    listKeys(holon, lens, opts) {
        return this.list(holon, lens, opts).map((r) => r.id);
    }

    listLenses(holon) {
        return Array.from(this.holonIndex.get(holonKey(holon)) || []);
    }

    /** Every holon the store holds records for (globals and reserved namespaces excluded). */
    listHolons() {
        const out = [];
        for (const key of this.holonIndex.keys()) {
            if (key === GLOBAL_HOLON || key === CAPABILITIES_HOLON) continue;
            out.push(holonFromKey(key));
        }
        return out;
    }

    /** Latest signed claim per author at an address, newest first. */
    getEvents(holon, lens, id) {
        const byAuthor = this.eventsByAddr.get(addr(holon, lens, id));
        if (!byAuthor) return [];
        const out = [];
        for (const eid of byAuthor.values()) {
            const e = this.events.get(eid);
            if (e) out.push(e);
        }
        return out.sort(newestFirst);
    }

    /** The fields of a record whose current value `pubkey` signed (see clock.js). */
    fieldsBy(holon, lens, id, pubkey) {
        return fieldsBy(this._claimsAt(addr(holon, lens, id)), pubkey);
    }

    /** Ids that have at least one signed claim in a lens. */
    listEventIds(holon, lens) {
        return Array.from(this.eventIdsByLens.get(lensKey(holon, lens)) || []);
    }

    /** Souls of the hologram pointers that reference a source soul. */
    getBacklinks(soul) {
        return Array.from(this.backlinks.get(soul) || []);
    }

    soulOf(holon, lens, id) {
        return soulOf(this.appName, holon, lens, id);
    }

    // ------------------------------------------------------------------ change feed

    /**
     * Watch a lens. With `replay` (default) the current non-tombstone records
     * are delivered on a microtask — AFTER the caller has its unsubscribe
     * handle — then every accepted change (tombstones included) streams in
     * apply order. Returns the unsubscribe function.
     */
    watch(holon, lens, cb, { replay = true } = {}) {
        if (typeof cb !== 'function') throw new Error('store.watch: callback required');
        const lk = lensKey(holon, lens);
        let set = this.watchers.get(lk);
        if (!set) { set = new Set(); this.watchers.set(lk, set); }
        // Until the replay has run, ids delivered live are remembered so a
        // caller that subscribes and writes in the same tick does not see
        // its own write twice.
        const entry = { cb, active: true, liveBeforeReplay: replay ? new Set() : null };
        set.add(entry);
        if (replay) {
            queueMicrotask(() => {
                const skip = entry.liveBeforeReplay;
                entry.liveBeforeReplay = null;
                if (!entry.active) return;
                const idx = this.lensIndex.get(lk);
                if (!idx) return;
                for (const rec of Array.from(idx.values())) {
                    if (!entry.active) break;
                    if (isTombstone(rec.item) || isLocked(rec.item) || skip.has(rec.id)) continue;
                    this._deliver(entry, rec, true);
                }
            });
        }
        return () => {
            entry.active = false;
            set.delete(entry);
            if (!set.size) this.watchers.delete(lk);
        };
    }

    // ------------------------------------------------------------------ cursors

    getCursor(holon, lens, wire) {
        return this.cursors.get(cursorKey(holon, lens, wire)) || null;
    }

    setCursor(holon, lens, since, wire) {
        const lk = cursorKey(holon, lens, wire);
        const cur = this.cursors.get(lk);
        const value = { since: Math.max(since || 0, cur?.since || 0), syncedAt: Date.now() };
        this.cursors.set(lk, value);
        this._enqueue({ t: 'cur', k: lk, v: value });
        return value;
    }

    // ------------------------------------------------------------------ outbox

    /**
     * Remember a signed event until a relay acknowledges it. A replaceable
     * event (kinds 10000–19999, 30000–39999, 0, 3) evicts the unsent older
     * one at the same coordinate: the relay keeps only the newest, so sending
     * the older one would be a wasted round trip. Returns the ids evicted.
     */
    outboxAdd(event) {
        if (!event || typeof event !== 'object' || !event.id) return [];
        const evicted = [];
        const coord = replaceableCoordinate(event);
        if (coord) {
            for (const other of this.outbox.values()) {
                if (other.id === event.id || replaceableCoordinate(other) !== coord) continue;
                if (other.created_at > event.created_at) return evicted; // a newer claim is already waiting
                this.outbox.delete(other.id);
                this._enqueue({ t: 'out-del', id: other.id });
                evicted.push(other.id);
            }
        }
        this.outbox.set(event.id, event);
        this._enqueue({ t: 'out', v: event });
        return evicted;
    }

    /** A relay took the event (or it will never be taken): forget it. */
    outboxRemove(id) {
        const had = this.outbox.delete(id);
        if (had) this._enqueue({ t: 'out-del', id });
        return had;
    }

    /** Events still awaiting a relay, oldest first. */
    outboxList() {
        return Array.from(this.outbox.values()).sort((a, b) => (a.created_at - b.created_at) || (a.id < b.id ? -1 : 1));
    }

    outboxSize() {
        return this.outbox.size;
    }

    // ------------------------------------------------------------------ private lenses

    privatePut(scope, lens, key, cipher) {
        const k = privateKeyOf(scope, lens, key);
        this.private.set(k, cipher);
        this._enqueue({ t: 'priv', k, v: cipher });
    }

    privateGet(scope, lens, key) {
        return this.private.get(privateKeyOf(scope, lens, key));
    }

    privateList(scope, lens) {
        const prefix = privateLensPrefix(scope, lens);
        const out = [];
        for (const [k, cipher] of this.private) {
            if (k.startsWith(prefix)) out.push({ key: k.slice(prefix.length), cipher });
        }
        return out;
    }

    privateDelete(scope, lens, key) {
        const k = privateKeyOf(scope, lens, key);
        const had = this.private.delete(k);
        if (had) this._enqueue({ t: 'priv-del', k });
        return had;
    }

    privateClear(scope, lens) {
        let n = 0;
        for (const { key } of this.privateList(scope, lens)) {
            if (this.privateDelete(scope, lens, key)) n++;
        }
        return n;
    }

    // ------------------------------------------------------------------ sealed content

    /** Install the function that opens sealed envelopes (see wire.js). */
    setUnseal(fn) {
        this.wire.setUnseal?.(fn);
        this._decoded = new WeakMap();
    }

    /**
     * Re-decode the current winning event at every address of a lens (or of
     * every lens when none is given) and replace the record when the item
     * changed — a locked stub opens once a key arrives, a plaintext record
     * locks again once the keys are gone. Watchers hear each change like any
     * other write. Returns the number of records that changed.
     */
    rescan({ holon, lens } = {}) {
        let changed = 0;
        this._decoded = new WeakMap();                        // keys moved: decode afresh
        const wantLk = lens !== undefined ? lensKey(holon, lens) : null;
        for (const rec of Array.from(this.records.values())) {
            if (wantLk !== null && lensKeyOfAddr(rec.addr) !== wantLk) continue;
            if (!rec.eventId) continue;                       // raw local writes have no envelope
            const atAddr = this._claimsAt(rec.addr);
            if (atAddr.some((c) => c.decoded.sealed) && atAddr.some((c) => hasClock(c.item))) {
                const folded = this._foldAt(rec.addr, rec);
                if (folded?.changed) {
                    this._setRecord({ ...folded.record, origin: rec.origin });
                    changed++;
                }
                continue;
            }
            const event = this.events.get(rec.eventId);
            if (!event) continue;
            const claims = this.wire.decode(event);
            if (!claims) continue;
            const decoded = claims.find((c) => addr(c.holon, c.lens, c.id) === rec.addr);
            if (!decoded || !decoded.sealed) continue;        // only sealed records can flip
            const before = rec.item;
            const after = decoded.item;
            if (isLocked(before) === isLocked(after) && JSON.stringify(before) === JSON.stringify(after)) continue;
            this._setRecord({ ...rec, item: after });
            changed++;
        }
        return changed;
    }

    // ------------------------------------------------------------------ export / import

    /** Signed events, oldest first, optionally narrowed to a holon, lens or authors. */
    exportEvents({ holon, lens, authors } = {}) {
        const wantH = holon === undefined ? undefined : holonKey(holon);
        const wantAuthors = authors ? new Set(authors) : null;
        const out = [];
        for (const e of this.events.values()) {
            if (wantAuthors && !wantAuthors.has(e.pubkey)) continue;
            // Narrow by DECODING, not by reading `h`/`l` off the event. Those
            // two tags are the 30078 envelope's way of carrying the address;
            // another encoding carries it somewhere else, and reading the tags
            // directly would export nothing at all for such a lens.
            if (wantH !== undefined || lens !== undefined) {
                const d = decodeEvent(e);
                if (!d) continue;
                if (wantH !== undefined && holonKey(d.holon) !== wantH) continue;
                if (lens !== undefined && d.lens !== String(lens)) continue;
            }
            out.push(e);
        }
        return out.sort((a, b) => (a.created_at - b.created_at) || (a.id < b.id ? -1 : 1));
    }

    /** Apply a batch of signed events (signatures verified). */
    importEvents(events, { origin = 'import' } = {}) {
        let applied = 0;
        let rejected = 0;
        for (const e of events || []) {
            const r = this.apply(e, { origin });
            if (r.applied) applied++;
            else if (r.reason !== 'seen' && r.reason !== 'stale') rejected++;
        }
        return { received: (events || []).length, applied, rejected };
    }

    // ------------------------------------------------------------------ internals

    /** An event's address claims, decoded once per event (rescan and setUnseal reset it). */
    _decode(event) {
        let claims = this._decoded.get(event);
        if (claims === undefined) {
            claims = this.wire.decode(event);
            this._decoded.set(event, claims);
        }
        return claims;
    }

    /** Every author's current claim at an address. */
    _claimsAt(a) {
        const byAuthor = this.eventsByAddr.get(a);
        if (!byAuthor) return [];
        const out = [];
        for (const eid of byAuthor.values()) {
            const e = this.events.get(eid);
            if (!e) continue;
            const decoded = (this._decode(e) || []).find((c) => addr(c.holon, c.lens, c.id) === a);
            if (decoded) out.push({ item: decoded.item, created_at: e.created_at, eventId: e.id, pubkey: e.pubkey, decoded });
        }
        return out;
    }

    /**
     * The field-clock fold at an address, or null when no claim there carries
     * a clock (plain last-writer-wins applies). `changed` says whether the
     * fold differs from `current`.
     */
    _foldAt(a, current) {
        const claims = this._claimsAt(a);
        if (!claims.some((c) => hasClock(c.item))) return null;
        let newest = claims[0];
        for (const c of claims) if (wins(c, newest)) newest = c;
        // An unsigned local write newer than every signed claim stays current.
        if (current && !current.eventId && !wins(newest, current)) return { changed: false };
        const item = foldClaims(claims, clockAddress(newest.decoded.holon, newest.decoded.lens, newest.decoded.id));
        const record = {
            addr: a,
            holon: newest.decoded.holon,
            lens: newest.decoded.lens,
            id: newest.decoded.id,
            item,
            created_at: newest.created_at,
            pubkey: newest.pubkey,
            eventId: newest.eventId,
        };
        const changed = !current || current.eventId !== record.eventId || !sameItem(current.item, item);
        return { changed, record };
    }

    _storeEvent(a, decoded, event) {
        let byAuthor = this.eventsByAddr.get(a);
        if (!byAuthor) { byAuthor = new Map(); this.eventsByAddr.set(a, byAuthor); }
        const ck = claimKey(event);
        const prevId = byAuthor.get(ck);
        if (prevId) {
            const prev = this.events.get(prevId);
            if (prev && !wins({ created_at: event.created_at, eventId: event.id }, { created_at: prev.created_at, eventId: prev.id })) {
                return false; // older than this author's latest claim — not kept
            }
            this.events.delete(prevId);
            this._enqueue({ t: 'evt-del', id: prevId });
        }
        byAuthor.set(ck, event.id);
        this.events.set(event.id, event);
        const lk = lensKey(decoded.holon, decoded.lens);
        let ids = this.eventIdsByLens.get(lk);
        if (!ids) { ids = new Set(); this.eventIdsByLens.set(lk, ids); }
        ids.add(decoded.id);
        this._enqueue({ t: 'evt', v: event });
        return true;
    }

    /**
     * Index an event loaded from a snapshot (no persistence, no LWW).
     *
     * Decodes through the SAME wire registry as `apply`. Reading the envelope
     * tags directly here instead would drop every standard-kind event from the
     * index on restart — silently, with the records still present, and with
     * `nextCreatedAt` then handing out timestamps that collide on the relay.
     */
    _indexEvent(event) {
        if (!event || !event.id) return;
        const claims = this.wire.decode(event);
        if (!claims) return;
        for (const decoded of claims) this._indexClaim(event, decoded);
    }

    _indexClaim(event, decoded) {
        const a = addr(decoded.holon, decoded.lens, decoded.id);
        let byAuthor = this.eventsByAddr.get(a);
        if (!byAuthor) { byAuthor = new Map(); this.eventsByAddr.set(a, byAuthor); }
        const ck = claimKey(event);
        const prevId = byAuthor.get(ck);
        if (prevId) {
            const prev = this.events.get(prevId);
            if (prev && !wins({ created_at: event.created_at, eventId: event.id }, { created_at: prev.created_at, eventId: prev.id })) return;
            this.events.delete(prevId);
        }
        byAuthor.set(ck, event.id);
        this.events.set(event.id, event);
        const lk = lensKey(decoded.holon, decoded.lens);
        let ids = this.eventIdsByLens.get(lk);
        if (!ids) { ids = new Set(); this.eventIdsByLens.set(lk, ids); }
        ids.add(decoded.id);
    }

    _setRecord(record, { persist = true, emit = true } = {}) {
        const a = record.addr;
        const prev = this.records.get(a);
        this.records.set(a, record);

        const lk = lensKeyOfAddr(a);
        let idx = this.lensIndex.get(lk);
        if (!idx) { idx = new Map(); this.lensIndex.set(lk, idx); }
        idx.set(record.id, record);

        const hk = holonKey(record.holon);
        let lenses = this.holonIndex.get(hk);
        if (!lenses) { lenses = new Set(); this.holonIndex.set(hk, lenses); }
        lenses.add(record.lens);

        // Backlinks: a live hologram pointer references its source soul.
        const mySoul = soulOf(this.appName, record.holon, record.lens, record.id);
        if (prev && isHologram(prev.item) && !isTombstone(prev.item)) {
            this._unlink(prev.item.soul, mySoul);
        }
        if (isHologram(record.item) && !isTombstone(record.item)) {
            this._link(record.item.soul, mySoul);
        }

        if (persist) this._enqueue({ t: 'rec', v: record });
        if (emit) {
            const set = this.watchers.get(lk);
            if (set && set.size) {
                for (const entry of Array.from(set)) {
                    if (entry.active) this._deliver(entry, record, false);
                }
            }
        }
    }

    _link(sourceSoul, pointerSoul) {
        if (!sourceSoul || sourceSoul === pointerSoul) return;
        let set = this.backlinks.get(sourceSoul);
        if (!set) { set = new Set(); this.backlinks.set(sourceSoul, set); }
        set.add(pointerSoul);
    }

    _unlink(sourceSoul, pointerSoul) {
        const set = this.backlinks.get(sourceSoul);
        if (!set) return;
        set.delete(pointerSoul);
        if (!set.size) this.backlinks.delete(sourceSoul);
    }

    _deliver(entry, record, replay) {
        if (!replay && entry.liveBeforeReplay) entry.liveBeforeReplay.add(record.id);
        try {
            entry.cb(record.item, record.id, {
                tombstone: isTombstone(record.item),
                locked: isLocked(record.item),
                created_at: record.created_at,
                pubkey: record.pubkey,
                eventId: record.eventId,
                origin: record.origin,
                replay,
            });
        } catch (e) {
            console.warn(`[holosphere/store] watcher for ${record.lens} threw: ${e?.message}`);
        }
    }

    _enqueue(op) {
        if (!this.adapter || this._closed) return;
        this._ops.push(op);
        if (!this._flushQueued) {
            this._flushQueued = true;
            queueMicrotask(() => this._flushNow());
        }
    }

    _flushNow() {
        this._flushQueued = false;
        if (!this._ops.length || !this.adapter) return;
        const ops = this._ops;
        this._ops = [];
        // Coalesce cursor ops for the same lens into the last one.
        const lastCursor = new Map();
        const batch = [];
        for (const op of ops) {
            if (op.t === 'cur') { lastCursor.set(op.k, op); continue; }
            batch.push(op);
        }
        for (const op of lastCursor.values()) batch.push(op);
        this._opsSinceCompact += batch.length;
        const adapter = this.adapter;
        this._writeChain = this._writeChain
            .then(() => adapter.append(batch))
            .catch((e) => console.warn(`[holosphere/store] persist failed: ${e?.message}`));
        if (this._opsSinceCompact >= this.compactAfter) {
            this._opsSinceCompact = 0;
            this._writeChain = this._writeChain
                .then(() => adapter.snapshot(this.snapshot()))
                .catch((e) => console.warn(`[holosphere/store] compaction failed: ${e?.message}`));
        }
    }
}
