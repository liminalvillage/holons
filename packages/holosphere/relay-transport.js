// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Nostr relay transport — the relay IS the wire.
//
//   write  →  every non-private put/delete is a signed kind-30078 event
//             (NIP-33 replaceable per location) published to the relay set —
//             holograms and globals included. The event goes into the store's
//             OUTBOX first and leaves it only once a relay says OK; what no
//             relay took is replayed on reconnect, on wake, on a backoff
//             timer and at the next start, so a write made offline is never
//             stranded in one device's store.
//   read   →  a PULL. `ensureSync(holon, lens)` catches the pair up from the
//             relays (paginated backfill on a cold store, a `since` query from
//             the persisted cursor on a warm one) and resolves; reads then
//             answer from the store. A pair pulled a moment ago is fresh
//             (`freshnessMs`) and costs nothing; pulls run through a small
//             query budget so a cold start never floods the relay. A read
//             leaves NO subscription behind.
//   watch  →  a PUSH, owned by the subscriber. `watch(holon, lens)` keeps the
//             pair live for as long as someone holds the release function.
//             Every watched pair, every reverse-sync filter and every raw
//             listener share ONE multiplexed REQ per relay (a handful when the
//             filter list is long), re-issued when the set changes. Nothing
//             watched → nothing open.
//
// Relays cap concurrent REQs per connection (strfry: 20 by default). A
// process that touches hundreds of (holon, lens) pairs — the bot serves
// every hub it is in — must therefore never hold a subscription per pair,
// and must not fire hundreds of catch-up queries at once either. Every event
// lands in the store through `store.apply`, which verifies it, decides
// last-writer-wins and fires the local subscribers.
//
// Event scheme (nostr-events.js / signing.js):
//   tags [["h", holon], ["l", lens], ["d", "holon/lens/id"], ["n", appname]]
// The `n` (namespace) tag scopes events to one app namespace so `Holons` and
// `HolonsDebug` can share a relay; globals (holon == null) use the `_g`
// sentinel in `h`.

import { matchFilter } from 'nostr-tools/filter';
import { buildEvent, getPublicKey, HOLOSPHERE_KIND } from './nostr-events.js';
import { createProjector } from './projections.js';
import { createReverseSync } from './reverse-sync.js';
import { GLOBAL_HOLON } from './store/address.js';

/** `h`-tag sentinel for holon-less (global) records. */
export const GLOBAL_HOLON_TAG = GLOBAL_HOLON;

const EVENTS_NS = '_events';

/** How long a cold read waits for the relay catch-up before proceeding with
 *  whatever is local. The catch-up keeps running in the background. */
const DEFAULT_SYNC_TIMEOUT_MS = 5000;

/** Page size for the cold backfill — strfry's default `maxFilterLimit`. */
const DEFAULT_PAGE_SIZE = 500;

/** A pair pulled this recently is answered from the store without a query:
 *  a command handler reads the same lens several times in a row. */
const DEFAULT_FRESHNESS_MS = 3000;

/** Catch-up queries in flight at once. Each is a REQ the relay counts
 *  against its per-connection cap; a few at a time saturate the link. */
const DEFAULT_MAX_CONCURRENT_QUERIES = 6;

/** Filters per live REQ. Relays bound this (strfry `maxReqFilterSize`, and an
 *  optional strict validation at 3); one REQ is the norm, this is the cap. */
const DEFAULT_MAX_FILTERS_PER_REQ = 10;

/** Values per filter list (`#h`, `authors`, …) before a second filter is cut. */
const DEFAULT_MAX_FILTER_LIST = 100;

/** Overlap re-fetched before a cursor so clock skew between writers cannot
 *  hide an event (re-applying a seen event is a no-op). */
const CATCHUP_OVERLAP_SEC = 900;

/** Backoff for reopening the live REQ the relay hard-closed. */
const REOPEN_BACKOFF_MS = [3000, 10000, 30000, 60000];

/** Watch/release bursts (a view mounting ten components) coalesce into one REQ. */
const FIRE_DEBOUNCE_MS = 50;

/** Backoff between outbox replays while no relay takes our events. */
const OUTBOX_RETRY_MS = [5000, 15000, 60000, 300000];

/** A relay verdict that will not change on retry: the event is dropped from
 *  the outbox (with a warning) instead of being resent forever. `duplicate`
 *  and `replaced` only reach here as an OK=false (the relay already holds this
 *  or a newer claim — an OK=true duplicate counts as acknowledged). Anything
 *  else — connection failure, rate limit, an unexplained refusal — is retried. */
const TERMINAL_VERDICT = /^(invalid|blocked|pow|restricted|duplicate|replaced):/i;

/** What nostr-tools' pool FULFILS a publish with when a relay cannot be reached. */
const UNREACHABLE = /^connection (failure|skipped)/i;

const MAX_BACKFILL_PAGES = 2000;

// One import of the pool module per process. Two transports importing it at
// the same moment (two instances in one test) can each see a half-linked
// namespace under jest's ESM loader (`SimplePool is not a constructor`), and
// nothing that instance publishes ever leaves. A shared promise makes the
// second importer wait for the first.
let poolModulePromise = null;
const loadPoolModule = () => (poolModulePromise ??= import('nostr-tools/pool'));

const chunks = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

const isListKey = (k) => k === 'authors' || k === 'ids' || k[0] === '#';
const sameList = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * Fold filters that differ in exactly one list (`#t`, `authors`, …) into one
 * filter with the union, so N holons' identical filter shapes become one.
 * `since` takes the minimum (over-fetching is deduped by the store). A list
 * never grows past `maxList`.
 */
export function mergeFilters(filters, maxList = DEFAULT_MAX_FILTER_LIST) {
  const out = [];
  for (const f of filters) {
    if (!f || typeof f !== 'object') continue;
    const listKeys = Object.keys(f).filter(isListKey).sort();
    const base = {};
    for (const k of Object.keys(f)) if (!isListKey(k) && k !== 'since') base[k] = f[k];
    if (Array.isArray(base.kinds)) base.kinds = [...base.kinds].sort((a, b) => a - b);
    const sig = JSON.stringify([base, listKeys]);
    let merged = false;
    for (const o of out) {
      if (o.sig !== sig) continue;
      const diff = listKeys.filter((k) => !sameList(o.filter[k], f[k]));
      if (diff.length > 1) continue;
      if (diff.length === 1) {
        const union = [...new Set([...o.filter[diff[0]], ...f[diff[0]]])];
        if (union.length > maxList) continue;
        o.filter[diff[0]] = union;
      }
      if (f.since !== undefined) o.filter.since = o.filter.since === undefined ? f.since : Math.min(o.filter.since, f.since);
      merged = true;
      break;
    }
    if (!merged) {
      const copy = { ...f };
      for (const k of listKeys) copy[k] = [...new Set(f[k])];
      out.push({ sig, filter: copy });
    }
  }
  return out.map((o) => o.filter);
}

export function createRelayTransport(holo, {
  relays = [],
  privateKey,
  kind = HOLOSPHERE_KIND,
  syncTimeoutMs = DEFAULT_SYNC_TIMEOUT_MS,
  pageSize = DEFAULT_PAGE_SIZE,
  freshnessMs = DEFAULT_FRESHNESS_MS,
  maxConcurrentQueries = DEFAULT_MAX_CONCURRENT_QUERIES,
  maxFiltersPerReq = DEFAULT_MAX_FILTERS_PER_REQ,
  maxFilterList = DEFAULT_MAX_FILTER_LIST,
  verbose = false,
  // Standard-kind projections (see projections.js / @holons/core/nostr).
  projections = [],
  signerFor = null,
  providerKey = null,
  // Reverse sync of external standard-kind edits (see reverse-sync.js).
  reverseSync = true,
  trustedAuthors = null,
  reverseLookbackSec,
} = {}) {
  if (!relays.length) throw new Error('relay-transport: at least one relay is required');
  if (!privateKey) throw new Error('relay-transport: a privateKey is required');
  if (!holo?.store) throw new Error('relay-transport: the instance has no store');

  const pubkey = getPublicKey(privateKey);
  const app = holo.appname;
  const store = holo.store;
  const vlog = (...a) => { if (verbose) console.log('[nostr-transport]', ...a); };
  const projector = createProjector({ projections, privateKey, signerFor, providerKey, verbose });

  let pool = null;
  let closed = false;
  const poolReady = (async () => {
    const mod = await loadPoolModule();
    // Node < 22 has no global WebSocket, and nostr-tools then reports every
    // publish as a connection failure — hand it the `ws` implementation. In
    // the browser this branch is dead code.
    if (typeof globalThis.WebSocket === 'undefined') {
      try {
        const { default: WS } = await import('ws');
        mod.useWebSocketImplementation(WS);
      } catch (e) {
        console.warn('[nostr-transport] no WebSocket implementation available:', e?.message);
      }
    }
    // Reconnect keeps the live REQ alive across relay drops: nostr-tools
    // reopens the socket and re-fires open subscriptions with `since` set
    // past what they last emitted.
    pool = new mod.SimplePool({ enableReconnect: true });
    return pool;
  })();

  const normHolon = (h) => (h === null || h === undefined || h === '' ? null : h);
  const wireHolon = (h) => (normHolon(h) === null ? GLOBAL_HOLON_TAG : String(h));
  const pairKey = (h, lens) => `${wireHolon(h)}|${lens}`;

  // ---- query budget ----------------------------------------------------------

  let slots = 0;
  const waiting = [];
  function withSlot(fn) {
    return new Promise((resolve, reject) => {
      const run = async () => {
        slots++;
        try { resolve(await fn()); } catch (e) { reject(e); } finally {
          slots--;
          const next = waiting.shift();
          if (next) next();
        }
      };
      if (slots < maxConcurrentQueries) run();
      else waiting.push(run);
    });
  }

  /** One bounded relay query (a REQ closed on EOSE) through the budget. */
  function query(filter) {
    return withSlot(async () => {
      if (closed) return [];
      const p = await poolReady;
      if (closed) return [];
      return p.querySync(relays, filter, { maxWait: syncTimeoutMs });
    });
  }

  const reverse = reverseSync && projector.enabled
    ? createReverseSync(holo, { query, relays, projector, pubkey, trustedAuthors, lookbackSec: reverseLookbackSec, freshnessMs, verbose })
    : null;

  // ---- publishing ------------------------------------------------------------

  // The outbox: every event we publish sits in the store until ONE relay
  // acknowledges it. `send` is the wire attempt; `publishEvent` is enqueue +
  // send; `flushOutbox` resends whatever is still waiting.
  const outbox = { timer: null, attempts: 0, flushing: null, inflight: new Set() };

  function sent(event) {
    outbox.attempts = 0;
    store.outboxRemove(event.id);
  }

  function scheduleOutboxRetry() {
    if (closed || outbox.timer || !store.outboxSize()) return;
    const delay = OUTBOX_RETRY_MS[Math.min(outbox.attempts++, OUTBOX_RETRY_MS.length - 1)];
    outbox.timer = setTimeout(() => { outbox.timer = null; flushOutbox().catch(() => {}); }, delay);
    if (typeof outbox.timer.unref === 'function') outbox.timer.unref();
  }

  /**
   * One wire attempt. Resolves true when at least one relay said OK (the
   * event leaves the outbox), false when none did (it stays, and a retry is
   * scheduled). A terminal verdict from every relay drops it as well.
   */
  async function send(event) {
    if (closed || !event) return false;
    if (outbox.inflight.has(event.id)) return false;
    outbox.inflight.add(event.id);
    try {
      const p = await poolReady;
      if (closed) return false;
      const results = await Promise.allSettled(p.publish(relays, event));
      // nostr-tools: a relay's OK fulfils with its message, an unreachable
      // relay FULFILS with "connection failure: …", and an OK=false or a
      // timeout rejects. Only the first is an acknowledgement.
      if (results.some((x) => x.status === 'fulfilled' && !UNREACHABLE.test(String(x.value ?? '')))) {
        sent(event);
        return true;
      }
      const reasons = results.map((x) => String(x.status === 'fulfilled' ? x.value : (x.reason?.message ?? x.reason ?? '')));
      if (reasons.length && reasons.every((r) => TERMINAL_VERDICT.test(r))) {
        console.warn(`[nostr-transport] every relay refused ${event.id} (${reasons[0]}); dropped from the outbox`);
        store.outboxRemove(event.id);
        return false;
      }
      vlog('publish reached no relay:', event.id, reasons[0]);
      scheduleOutboxRetry();
      return false;
    } catch (e) {
      vlog('publish failed:', e?.message);
      scheduleOutboxRetry();
      return false;
    } finally {
      outbox.inflight.delete(event.id);
    }
  }

  function publishEvent(event) {
    if (closed || !event) return;
    store.outboxAdd(event);
    send(event).catch(() => {});
  }

  /**
   * Resend every event still awaiting a relay, oldest first. Runs once at a
   * time; a call during a run returns the running one. Resolves to the
   * number of events acknowledged.
   */
  function flushOutbox() {
    if (closed) return Promise.resolve(0);
    if (outbox.flushing) return outbox.flushing;
    if (outbox.timer) { clearTimeout(outbox.timer); outbox.timer = null; }
    outbox.flushing = (async () => {
      let ok = 0;
      for (const event of store.outboxList()) {
        if (closed) break;
        if (outbox.inflight.has(event.id)) continue; // its own first attempt is still out
        if (await send(event)) ok++;
        else break; // the wire is down: the retry timer picks the rest up
      }
      return ok;
    })().finally(() => { outbox.flushing = null; });
    return outbox.flushing;
  }

  // What the last run left behind goes out as soon as the pool is up.
  poolReady.then(() => { if (store.outboxSize()) flushOutbox().catch(() => {}); }).catch(() => {});

  function buildFor(holon, lens, item, content) {
    return buildEvent({
      holon: wireHolon(holon),
      lens,
      item,
      sk: privateKey,
      kind,
      content,
      created_at: store.nextCreatedAt(normHolon(holon), lens, String(item.id)),
      extraTags: [['n', app]],
    });
  }

  function withId(item, key) {
    if (!item) return null;
    if (item.id != null) return item;
    if (key == null) return null; // nothing addressable to replace on the relay
    return { ...item, id: String(key) };
  }

  /**
   * Publish a write. Fire-and-forget — never blocks the put. The signing
   * layer normally hands over the event it already issued (`signedEvent`) so
   * the wire carries exactly what the store holds; without one the transport
   * signs with its own key and applies that event locally.
   */
  function publishWrite(holon, lens, item, { key, signedEvent, skipProjections = false, content } = {}) {
    if (closed) return;
    try {
      const addressed = withId(item, key);
      let event = signedEvent;
      if (!event) {
        if (!addressed) return;
        event = buildFor(holon, lens, addressed, content);
        store.apply(event, { origin: 'local' });
      }
      publishEvent(event);
      // Standard-kind projections ride alongside; never ingested back here (the
      // store only accepts `kind`) — external edits of them arrive via
      // reverse-sync.js, and a write that folds such an edit in must not
      // re-project it (`skipProjections`).
      if (skipProjections || !addressed) return;
      for (const p of projector.eventsForWrite(holon, lens, addressed)) publishEvent(p);
    } catch (e) {
      vlog('publishWrite failed:', e?.message);
    }
  }

  /** Publish a tombstone so the delete travels the wire (+ NIP-09 retractions). */
  function publishDelete(holon, lens, key, signedEvent = null) {
    if (closed || key == null) return;
    publishWrite(holon, lens, { id: String(key), _deleted: true }, { signedEvent, skipProjections: true });
    for (const p of projector.eventsForDelete(holon, lens, key)) publishEvent(p);
  }

  // ---- ingesting -------------------------------------------------------------

  function ingest(event) {
    if (closed || !event) return { applied: false, reason: 'closed' };
    const r = store.apply(event, { origin: 'remote' });
    if (r.applied) vlog('ingested', event.id.slice(0, 8), r.record.lens, r.record.id, r.record.item?._deleted ? '(tombstone)' : '');
    else if (r.reason === 'invalid') vlog('dropped forged event', event.id);
    return r;
  }

  // ---- pairs: one state per (holon, lens) ever touched --------------------------

  const pairs = new Map(); // key -> state

  /**
   * Every wire a lens is carried on, as `{ wire, filter }`.
   *
   * The legacy envelope is always first and always id `'30078'`, which is what
   * keeps cursors already on disk resolving to the same key. A lens whose
   * codec claims a standard kind contributes its own REQ shapes after it. The
   * wire id is derived from the kinds so it stays stable across restarts;
   * cursors are per wire, so a lens can be warm on one and cold on another.
   */
  function filtersFor(holon, lens) {
    const out = [{
      wire: '30078',
      filter: { kinds: [kind], '#h': [wireHolon(holon)], '#l': [String(lens)], '#n': [app] },
    }];
    const seen = new Set(['30078']);
    for (const w of store.wire?.wiresFor?.(lens) || []) {
      let filters = [];
      try { filters = w.filters?.(wireHolon(holon)) || []; } catch (e) { vlog('wire filters failed:', w.lens, e?.message); }
      for (const filter of filters) {
        let id = `std:${[...(filter.kinds || [])].sort((a, b) => a - b).join('-')}`;
        while (seen.has(id)) id += '+';
        seen.add(id);
        out.push({ wire: id, filter });
      }
    }
    return out;
  }

  function pairState(holon, lens) {
    const h = normHolon(holon);
    const key = pairKey(h, lens);
    let st = pairs.get(key);
    if (!st) {
      st = {
        key, holon: h, lens: String(lens),
        wires: filtersFor(h, lens).map(({ wire, filter }) => ({ wire, filter, synced: false })),
        watchers: 0, freshAt: 0, inflight: null, bounded: null,
      };
      pairs.set(key, st);
    }
    return st;
  }

  // ---- pull ------------------------------------------------------------------

  /**
   * Paginated backfill of a wire the store has never synced. Returns the
   * newest created_at seen.
   *
   * NIP-01 pages by `until` alone, at one-second resolution. A burst of
   * writes in the same second can fill a whole page, and `until = oldest`
   * would then return that same page forever. So every full page is followed
   * by a drain of its boundary second (`since = until = oldest`) and the walk
   * moves to `oldest - 1`: strictly older, every time. A second holding more
   * events than the relay's page cap is the one thing this cannot see.
   */
  async function backfill(filter) {
    let until;
    let newest = 0;
    const take = (events) => {
      let oldest = Infinity;
      for (const e of events) {
        if (e.created_at < oldest) oldest = e.created_at;
        if (e.created_at > newest) newest = e.created_at;
        ingest(e);
      }
      return oldest;
    };
    for (let page = 0; page < MAX_BACKFILL_PAGES; page++) {
      const q = { ...filter, limit: pageSize };
      if (until !== undefined) q.until = until;
      const events = await query(q);
      if (!events.length) break;
      const oldest = take(events);
      if (events.length < pageSize) break; // the end of history
      // No `limit`: the relay answers with as much of that second as it will
      // give (strfry: its `maxFilterLimit`), which `limit` would only cut.
      take(await query({ ...filter, since: oldest, until: oldest }));
      if (oldest <= 0) break;
      until = oldest - 1;
    }
    return newest;
  }

  /** Fetch what was published since a cursor. Returns the newest created_at seen. */
  async function catchUp(filter, since) {
    const events = await query({ ...filter, since });
    let newest = 0;
    for (const e of events) {
      if (e.created_at > newest) newest = e.created_at;
      ingest(e);
    }
    return newest;
  }

  /** Is this pair carried by the live REQ right now (so a pull is redundant)? */
  const liveCovers = (st) => st.watchers > 0 && live.covers.has(st.key) && st.wires.every((w) => w.synced);

  /**
   * Catch a (holon, lens) up from the relays. The returned promise resolves
   * after the catch-up, bounded by `syncTimeoutMs` so an unreachable relay
   * never blocks reads; the catch-up itself continues in the background and
   * the cursor is only advanced once it completes. A pair pulled within
   * `freshnessMs`, or carried live, resolves at once.
   */
  function ensureSync(holon, lens) {
    if (closed || !lens || String(lens) === EVENTS_NS) return Promise.resolve();
    const st = pairState(holon, lens);
    if (liveCovers(st)) return Promise.resolve();
    if (st.inflight) return st.bounded;
    if (Date.now() - st.freshAt < freshnessMs) return Promise.resolve();

    st.inflight = (async () => {
      // Each wire catches up on its own cursor. A lens long warm on the
      // envelope still BACKFILLS a wire it has never carried, instead of
      // catching up from a `since` that belongs to a different stream.
      await Promise.all(st.wires.map(async (w) => {
        const cursor = store.getCursor(st.holon, st.lens, w.wire);
        let newest = cursor?.since || 0;
        try {
          if (!cursor) newest = Math.max(newest, await backfill(w.filter));
          else newest = Math.max(newest, await catchUp(w.filter, Math.max(0, cursor.since - CATCHUP_OVERLAP_SEC)));
          if (!closed) {
            w.synced = true;
            store.setCursor(st.holon, st.lens, newest, w.wire);
          }
        } catch (e) {
          vlog('catch-up failed:', e?.message);
        }
      }));
      if (!closed) st.freshAt = Date.now();
      // External edits of this holon's projections ride the same pull, in
      // the background: the read does not wait for a fold.
      reverse?.pull(st.holon)?.catch(() => {});
    })().finally(() => { st.inflight = null; st.bounded = null; });
    st.bounded = Promise.race([
      st.inflight,
      new Promise((resolve) => {
        const t = setTimeout(resolve, syncTimeoutMs);
        if (typeof t.unref === 'function') t.unref();
      }),
    ]);
    return st.bounded;
  }

  /** Mark every pair stale, re-pull the watched ones and resend the outbox (reconnect / wake). */
  let resyncing = null;
  function resync() {
    if (closed || resyncing) return resyncing || Promise.resolve();
    resyncing = (async () => {
      const work = [flushOutbox().catch(() => 0)];
      for (const st of pairs.values()) {
        st.freshAt = 0;
        if (st.watchers > 0) {
          live.covers.delete(st.key);
          work.push(ensureSync(st.holon, st.lens).catch(() => {}));
        }
      }
      await Promise.all(work);
      scheduleFire();
    })().finally(() => { resyncing = null; });
    return resyncing;
  }

  // A browser tab that comes back online or into view catches up right away.
  const onOnline = () => { resync().catch(() => {}); };
  const onVisible = () => { if (typeof document === 'undefined' || document.visibilityState === 'visible') resync().catch(() => {}); };
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('online', onOnline);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
  }

  // ---- push: ONE multiplexed live REQ per relay ---------------------------------

  const raws = new Set(); // { filter, onevent }
  const live = { subs: [], gen: 0, covers: new Set(), sig: '', timer: null, reopenAttempts: 0 };

  /** Keep (holon, lens) live until the returned release is called. */
  function watch(holon, lens) {
    if (closed || !lens || String(lens) === EVENTS_NS) return () => {};
    const st = pairState(holon, lens);
    st.watchers++;
    if (st.watchers === 1) {
      reverse?.ensure(st.holon);
      scheduleFire();
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      st.watchers--;
      if (st.watchers === 0) scheduleFire();
    };
  }

  /** A raw live listener on the relay set (any filter). Returns a close function. */
  function subscribeRaw(filter, onevent) {
    if (closed || !filter) return () => {};
    const entry = { filter: { ...filter }, onevent };
    raws.add(entry);
    scheduleFire();
    return () => { if (raws.delete(entry)) scheduleFire(); };
  }

  function scheduleFire(delay = FIRE_DEBOUNCE_MS) {
    if (closed) return;
    if (live.timer) clearTimeout(live.timer);
    live.timer = setTimeout(() => {
      live.timer = null;
      fire().catch((e) => vlog('live REQ failed:', e?.message));
    }, delay);
    if (typeof live.timer.unref === 'function') live.timer.unref();
  }

  /** The filter set the live REQ carries right now, and the pairs it covers. */
  async function liveFilters() {
    const since = Math.max(0, Math.floor(Date.now() / 1000) - CATCHUP_OVERLAP_SEC);
    const watched = [...pairs.values()].filter((s) => s.watchers > 0);
    const keys = new Set(watched.map((s) => s.key));
    const filters = [];
    // The envelope: one filter for every watched holon, all its lenses. Live
    // traffic is small, and a lens the view did not ask for simply lands in
    // the cache — far cheaper than a filter per pair.
    const holons = [...new Set(watched.map((s) => wireHolon(s.holon)))];
    for (const chunk of chunks(holons, maxFilterList)) filters.push({ kinds: [kind], '#h': chunk, '#n': [app], since });
    // Standard-kind wires and reverse-sync shapes, folded across holons.
    const std = [];
    for (const s of watched) for (const w of s.wires) if (w.wire !== '30078') std.push({ ...w.filter, since });
    if (reverse) {
      for (const h of new Set(watched.map((s) => s.holon))) {
        try { std.push(...await reverse.liveFilters(h)); } catch (e) { vlog('reverse filters failed:', e?.message); }
      }
    }
    filters.push(...mergeFilters(std, maxFilterList));
    // Raw listeners keep their own shape, `since` included, on every fire: a
    // gift wrap (NIP-59) carries a created_at randomised days into the past,
    // so "resume past what was last seen" would lose the next one. Replays
    // are the listener's to dedupe (they already are).
    for (const r of raws) filters.push({ ...r.filter });
    return { filters, keys };
  }

  function closeLive() {
    live.gen++;
    for (const s of live.subs.splice(0)) { try { s.close('closed by caller'); } catch { /* ignore */ } }
    live.covers = new Set();
    live.sig = '';
  }

  function dispatch(evt) {
    if (closed || !evt) return;
    for (const r of raws) {
      let hit = false;
      try { hit = matchFilter(r.filter, evt); } catch { hit = false; }
      if (!hit) continue;
      try { r.onevent(evt); } catch { /* listener */ }
    }
    if (store.wire?.accepts?.(evt.kind)) {
      const r = ingest(evt);
      // Allow-list, not a deny-list: the cursor may only follow an event this
      // store actually accounted for. A deny-list let every reason nobody had
      // thought of yet ('kind', 'untrusted', 'closed') advance the cursor,
      // which silently skips that history on the next catch-up.
      if (r.record && (r.applied || r.reason === 'seen' || r.reason === 'stale')) {
        const st = pairs.get(pairKey(r.record.holon, r.record.lens));
        const w = st?.wires.find((x) => (x.filter.kinds || []).includes(evt.kind));
        if (w?.synced) store.setCursor(st.holon, st.lens, evt.created_at, w.wire);
      }
    }
    reverse?.ingest(evt)?.catch?.(() => {});
  }

  /** (Re)issue the live REQ for the current set. Same set → no-op. */
  async function fire() {
    if (closed) return;
    const p = await poolReady;
    if (closed) return;
    const { filters, keys } = await liveFilters();
    if (closed) return;
    const sig = JSON.stringify(filters.map((f) => ({ ...f, since: 0 })));
    if (sig === live.sig && live.subs.length) return;
    // Replace: the old REQ is closed before the new one opens, so the relay
    // never counts both. The overlap `since` covers the gap.
    closeLive();
    live.sig = sig;
    live.covers = keys;
    if (!filters.length) return;
    const gen = live.gen;
    for (const group of chunks(filters, maxFiltersPerReq)) {
      const requests = relays.flatMap((url) => group.map((filter) => ({ url, filter })));
      const sub = p.subscribeMap(requests, {
        onevent: dispatch,
        oneose: () => { live.reopenAttempts = 0; },
        onclose: (reasons) => {
          // With reconnect enabled nostr-tools handles transient drops itself;
          // this fires when a relay hard-fails (connection refused / timed
          // out) or we replaced the REQ. Reopen with backoff, pulling the
          // watched pairs from their cursors first.
          if (closed || gen !== live.gen) return;
          if ((reasons || []).every((r) => /closed by caller/i.test(String(r)))) return;
          const delay = REOPEN_BACKOFF_MS[Math.min(live.reopenAttempts++, REOPEN_BACKOFF_MS.length - 1)];
          live.covers = new Set();
          live.sig = '';
          for (const st of pairs.values()) if (st.watchers > 0) st.freshAt = 0;
          scheduleFire(delay);
        },
      });
      live.subs.push(sub);
    }
    // A pair that joined the live set never caught up, or went stale while
    // the REQ was down: pull it now so the store is current under the REQ.
    for (const key of keys) {
      const st = pairs.get(key);
      if (st && (!st.wires.every((w) => w.synced) || st.freshAt === 0)) ensureSync(st.holon, st.lens).catch(() => {});
    }
  }

  /** Publish already-signed events (any kind) to the relay set. */
  function publishEvents(events) {
    for (const e of Array.isArray(events) ? events : [events]) {
      if (e && e.id) publishEvent(e);
    }
  }

  return {
    pubkey,
    relays: [...relays],
    publishWrite,
    publishEvents,
    subscribeRaw,
    /** One bounded relay query (REQ closed on EOSE) through the budget; [] once closed. */
    query,
    watch,
    projector,
    reverse,
    publishDelete,
    ensureSync,
    resync,
    /** Resend every event no relay has acknowledged yet; resolves to how many got through. */
    flushOutbox,
    /** Events published here that no relay has acknowledged (oldest first). */
    outboxList: () => store.outboxList(),
    outboxCount: () => store.outboxSize(),
    /** Test/diagnostic hook: number of (holon, lens) pairs ever pulled. */
    syncCount: () => pairs.size,
    /** Pairs currently held live by a watcher. */
    watchCount: () => [...pairs.values()].filter((s) => s.watchers > 0).length,
    /** Live REQs open per relay right now (0 when nothing is watched). */
    liveCount: () => live.subs.length,
    /** Whether a lens finished its catch-up. */
    isSynced: (holon, lens) => !!pairs.get(pairKey(normHolon(holon), lens))?.wires.every((w) => w.synced),
    close() {
      closed = true;
      if (live.timer) clearTimeout(live.timer);
      live.timer = null;
      if (outbox.timer) clearTimeout(outbox.timer);
      outbox.timer = null;
      closeLive();
      raws.clear();
      reverse?.close();
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('online', onOnline);
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
      }
      pairs.clear();
      for (const run of waiting.splice(0)) run(); // drain: each sees `closed` and returns []
      poolReady.then((p) => { try { p.close(relays); } catch { /* ignore */ } }).catch(() => {});
    },
  };
}

export default { createRelayTransport, mergeFilters, GLOBAL_HOLON_TAG };
