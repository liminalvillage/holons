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
//   backlinks source soul → Set<pointer soul>: derived from the records that
//             are hologram pointers; rebuilt on open, maintained on write.
//             This is the `_holograms` cascade index, no longer a sub-node.
//
// Ordering: `apply(event)` is the ONE place last-writer-wins is decided
// (lww.js). Everything else is bookkeeping and the change feed.

import { HOLOSPHERE_KIND, verifyEvent, eventToItem, tag } from '../nostr-events.js';
import { isHologram } from '../hologram.js';
import {
    GLOBAL_HOLON, CAPABILITIES_HOLON, holonKey, holonFromKey, lensKey, addr, lensKeyOfAddr, soulOf,
} from './address.js';
import { wins, newestFirst } from './lww.js';
import { privateKeyOf, privateLensPrefix } from './private.js';

const nowSec = () => Math.floor(Date.now() / 1000);

/** Is this item a tombstone? */
export function isTombstone(item) {
    return !!item && typeof item === 'object' && item._deleted === true;
}

/** Decode a kind-30078 event into its address + item, or null when malformed. */
export function decodeEvent(event) {
    if (!event || typeof event !== 'object' || typeof event.content !== 'string') return null;
    const h = tag(event, 'h');
    const lens = tag(event, 'l');
    if (!h || !lens) return null;
    const item = eventToItem(event);
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    let id = item.id !== undefined && item.id !== null ? String(item.id) : '';
    if (!id) {
        const d = tag(event, 'd') || '';
        id = d.split('/').slice(2).join('/');
    }
    if (!id) return null;
    return { holon: h === GLOBAL_HOLON ? null : h, lens, id, item };
}

export class Store {
    /**
     * @param {object} opts
     * @param {string} opts.appName          namespace this store mirrors (checked against the `n` tag)
     * @param {object|Function} opts.adapter  a StoreAdapter, or a thunk resolving to one
     * @param {number} [opts.kind]           event kind accepted by `apply` (default 30078)
     * @param {number} [opts.compactAfter]   ops appended before the log is compacted (default 50000)
     */
    constructor({ appName, adapter, kind = HOLOSPHERE_KIND, compactAfter = 50000 } = {}) {
        if (!appName) throw new Error('store: appName is required');
        this.appName = String(appName);
        this.kind = kind;
        this.compactAfter = compactAfter;

        this._adapterInit = adapter;
        this.adapter = null;
        this._opened = false;
        this._closed = false;

        this.records = new Map();
        this.events = new Map();
        this.eventsByAddr = new Map();   // addr → Map<pubkey, eventId>
        this.eventIdsByLens = new Map(); // lens key → Set<id>
        this.private = new Map();
        this.cursors = new Map();
        this.backlinks = new Map();      // soul → Set<soul>
        this.lensIndex = new Map();      // lens key → Map<id, record>
        this.holonIndex = new Map();     // holon key → Set<lens>
        this.watchers = new Map();       // lens key → Set<entry>

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
        this.private.clear(); this.cursors.clear(); this.backlinks.clear();
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
        };
    }

    stats() {
        return {
            records: this.records.size,
            events: this.events.size,
            private: this.private.size,
            cursors: this.cursors.size,
            lenses: this.lensIndex.size,
            holons: this.listHolons().length,
            watchers: Array.from(this.watchers.values()).reduce((n, s) => n + s.size, 0),
            adapter: this.adapter?.kind || null,
        };
    }

    // ------------------------------------------------------------------ writes

    /**
     * Apply a signed event. Returns `{ applied, reason, record }`; `reason` is
     * one of seen | kind | foreign | malformed | invalid | stale when not applied.
     */
    apply(event, { origin = 'remote', verify = true } = {}) {
        if (!event || typeof event !== 'object' || !event.id) return { applied: false, reason: 'malformed' };
        if (event.kind !== this.kind) return { applied: false, reason: 'kind' };
        const n = tag(event, 'n');
        if (n !== undefined && n !== this.appName) return { applied: false, reason: 'foreign' };
        const decoded = decodeEvent(event);
        if (!decoded) return { applied: false, reason: 'malformed' };
        const a = addr(decoded.holon, decoded.lens, decoded.id);
        const current = this.records.get(a);
        if (this.events.has(event.id)) return { applied: false, reason: 'seen', record: current };
        if (verify && !verifyEvent(event)) return { applied: false, reason: 'invalid' };

        this._storeEvent(a, decoded, event);

        const candidate = { created_at: event.created_at, eventId: event.id };
        if (!wins(candidate, current)) return { applied: false, reason: 'stale', record: current };

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
        return { applied: true, record };
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

    list(holon, lens, { includeDeleted = false } = {}) {
        const idx = this.lensIndex.get(lensKey(holon, lens));
        if (!idx) return [];
        const out = [];
        for (const rec of idx.values()) {
            if (!includeDeleted && isTombstone(rec.item)) continue;
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
                    if (isTombstone(rec.item) || skip.has(rec.id)) continue;
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

    getCursor(holon, lens) {
        return this.cursors.get(lensKey(holon, lens)) || null;
    }

    setCursor(holon, lens, since) {
        const lk = lensKey(holon, lens);
        const cur = this.cursors.get(lk);
        const value = { since: Math.max(since || 0, cur?.since || 0), syncedAt: Date.now() };
        this.cursors.set(lk, value);
        this._enqueue({ t: 'cur', k: lk, v: value });
        return value;
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

    // ------------------------------------------------------------------ export / import

    /** Signed events, oldest first, optionally narrowed to a holon, lens or authors. */
    exportEvents({ holon, lens, authors } = {}) {
        const wantH = holon === undefined ? undefined : holonKey(holon);
        const wantAuthors = authors ? new Set(authors) : null;
        const out = [];
        for (const e of this.events.values()) {
            if (wantH !== undefined && tag(e, 'h') !== wantH) continue;
            if (lens !== undefined && tag(e, 'l') !== String(lens)) continue;
            if (wantAuthors && !wantAuthors.has(e.pubkey)) continue;
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

    _storeEvent(a, decoded, event) {
        let byAuthor = this.eventsByAddr.get(a);
        if (!byAuthor) { byAuthor = new Map(); this.eventsByAddr.set(a, byAuthor); }
        const prevId = byAuthor.get(event.pubkey);
        if (prevId) {
            const prev = this.events.get(prevId);
            if (prev && !wins({ created_at: event.created_at, eventId: event.id }, { created_at: prev.created_at, eventId: prev.id })) {
                return false; // older than this author's latest claim — not kept
            }
            this.events.delete(prevId);
            this._enqueue({ t: 'evt-del', id: prevId });
        }
        byAuthor.set(event.pubkey, event.id);
        this.events.set(event.id, event);
        const lk = lensKey(decoded.holon, decoded.lens);
        let ids = this.eventIdsByLens.get(lk);
        if (!ids) { ids = new Set(); this.eventIdsByLens.set(lk, ids); }
        ids.add(decoded.id);
        this._enqueue({ t: 'evt', v: event });
        return true;
    }

    /** Index an event loaded from a snapshot (no persistence, no LWW). */
    _indexEvent(event) {
        const decoded = decodeEvent(event);
        if (!decoded || !event.id) return;
        const a = addr(decoded.holon, decoded.lens, decoded.id);
        let byAuthor = this.eventsByAddr.get(a);
        if (!byAuthor) { byAuthor = new Map(); this.eventsByAddr.set(a, byAuthor); }
        const prevId = byAuthor.get(event.pubkey);
        if (prevId) {
            const prev = this.events.get(prevId);
            if (prev && !wins({ created_at: event.created_at, eventId: event.id }, { created_at: prev.created_at, eventId: prev.id })) return;
            this.events.delete(prevId);
        }
        byAuthor.set(event.pubkey, event.id);
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
