// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Nostr relay transport — the relay IS the wire.
//
//   write  →  every non-private put/delete is a signed kind-30078 event
//             (NIP-33 replaceable per location) published to the relay set —
//             holograms and globals included.
//   read   →  `ensureSync(holon, lens)` catches the lens up from the relays
//             (paginated backfill on a cold store, a `since` query from the
//             persisted cursor on a warm one), then keeps ONE live REQ per
//             (holon, lens) open. Every event lands in the store through
//             `store.apply`, which verifies it, decides last-writer-wins and
//             fires the local subscribers.
//
// Event scheme (nostr-events.js / signing.js):
//   tags [["h", holon], ["l", lens], ["d", "holon/lens/id"], ["n", appname]]
// The `n` (namespace) tag scopes events to one app namespace so `Holons` and
// `HolonsDebug` can share a relay; globals (holon == null) use the `_g`
// sentinel in `h`.

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

/** Overlap re-fetched before a cursor so clock skew between writers cannot
 *  hide an event (re-applying a seen event is a no-op). */
const CATCHUP_OVERLAP_SEC = 900;

/** Backoff for reopening a subscription the relay hard-closed. */
const REOPEN_BACKOFF_MS = [3000, 10000, 30000, 60000];

const MAX_BACKFILL_PAGES = 2000;

export function createRelayTransport(holo, {
  relays = [],
  privateKey,
  kind = HOLOSPHERE_KIND,
  syncTimeoutMs = DEFAULT_SYNC_TIMEOUT_MS,
  pageSize = DEFAULT_PAGE_SIZE,
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
    const mod = await import('nostr-tools/pool');
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
    // Reconnect keeps the live subscriptions alive across relay drops:
    // nostr-tools reopens the socket and re-fires open subscriptions with
    // `since` set past what they last emitted.
    pool = new mod.SimplePool({ enableReconnect: true });
    return pool;
  })();
  const reverse = reverseSync && projector.enabled
    ? createReverseSync(holo, { poolReady, relays, projector, pubkey, trustedAuthors, lookbackSec: reverseLookbackSec, verbose })
    : null;

  const normHolon = (h) => (h === null || h === undefined || h === '' ? null : h);
  const wireHolon = (h) => (normHolon(h) === null ? GLOBAL_HOLON_TAG : String(h));

  // ---- publishing ------------------------------------------------------------

  function publishEvent(event) {
    if (closed || !event) return;
    poolReady
      .then((p) => Promise.allSettled(p.publish(relays, event)))
      .then((r) => {
        if (!r.some((x) => x.status === 'fulfilled')) vlog('publish reached no relay:', event.id);
      })
      .catch((e) => vlog('publish failed:', e?.message));
  }

  function buildFor(holon, lens, item) {
    return buildEvent({
      holon: wireHolon(holon),
      lens,
      item,
      sk: privateKey,
      kind,
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
  function publishWrite(holon, lens, item, { key, signedEvent, skipProjections = false } = {}) {
    if (closed) return;
    try {
      const addressed = withId(item, key);
      let event = signedEvent;
      if (!event) {
        if (!addressed) return;
        event = buildFor(holon, lens, addressed);
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

  // ---- sync per (holon, lens) ------------------------------------------------

  const syncs = new Map(); // "holon|lens" -> state

  function filterFor(holon, lens) {
    return { kinds: [kind], '#h': [wireHolon(holon)], '#l': [String(lens)], '#n': [app] };
  }

  /** Paginated backfill of a lens the store has never synced. Returns the newest created_at seen. */
  async function backfill(p, filter) {
    let until;
    let newest = 0;
    for (let page = 0; page < MAX_BACKFILL_PAGES; page++) {
      const q = { ...filter, limit: pageSize };
      if (until !== undefined) q.until = until;
      const events = await p.querySync(relays, q, { maxWait: syncTimeoutMs });
      if (!events.length) break;
      let fresh = 0;
      let oldest = Infinity;
      for (const e of events) {
        if (e.created_at < oldest) oldest = e.created_at;
        if (e.created_at > newest) newest = e.created_at;
        if (ingest(e).reason !== 'seen') fresh++;
      }
      if (events.length < pageSize || fresh === 0) break;
      until = oldest; // events at `oldest` are re-fetched and deduped as seen
    }
    return newest;
  }

  /** Fetch what was published since a cursor. Returns the newest created_at seen. */
  async function catchUp(p, filter, since) {
    const events = await p.querySync(relays, { ...filter, since }, { maxWait: syncTimeoutMs });
    let newest = 0;
    for (const e of events) {
      if (e.created_at > newest) newest = e.created_at;
      ingest(e);
    }
    return newest;
  }

  function openLive(p, state, since) {
    if (closed || !syncs.has(state.key)) return;
    const filter = { ...state.filter, since: Math.max(0, since - CATCHUP_OVERLAP_SEC) };
    // nostr-tools 2.x subscribeMany takes ONE filter (not an array).
    state.sub = p.subscribeMany(relays, filter, {
      onevent: (evt) => {
        const r = ingest(evt);
        if (state.synced && r.reason !== 'invalid' && r.reason !== 'malformed' && r.reason !== 'foreign') {
          // Live events arrive after the catch-up, so the cursor may follow them.
          store.setCursor(state.holon, state.lens, evt.created_at);
        }
      },
      oneose: () => { state.reopenAttempts = 0; },
      onclose: (reasons) => {
        // With reconnect enabled nostr-tools handles transient drops itself;
        // this fires when a relay hard-fails (connection refused / timed out)
        // or the caller closed the sub. Reopen with backoff, catching up from
        // the cursor first.
        if (closed || !syncs.has(state.key)) return;
        const callerClosed = (reasons || []).every((r) => /closed by caller/i.test(String(r)));
        if (callerClosed) return;
        const delay = REOPEN_BACKOFF_MS[Math.min(state.reopenAttempts++, REOPEN_BACKOFF_MS.length - 1)];
        state.reopenTimer = setTimeout(async () => {
          state.reopenTimer = null;
          if (closed || !syncs.has(state.key)) return;
          const cursor = store.getCursor(state.holon, state.lens);
          let newest = cursor?.since || 0;
          try {
            newest = Math.max(newest, await catchUp(p, state.filter, Math.max(0, newest - CATCHUP_OVERLAP_SEC)));
            if (state.synced) store.setCursor(state.holon, state.lens, newest);
          } catch (e) { vlog('reopen catch-up failed:', e?.message); }
          openLive(p, state, newest);
        }, delay);
        if (typeof state.reopenTimer.unref === 'function') state.reopenTimer.unref();
      },
    });
  }

  /**
   * Catch a (holon, lens) up from the relays (once) and keep it live. The
   * returned promise resolves after the catch-up, bounded by `syncTimeoutMs`
   * so an unreachable relay never blocks reads; the catch-up itself continues
   * in the background and the cursor is only advanced once it completes.
   */
  function ensureSync(holon, lens) {
    if (closed || !lens || String(lens) === EVENTS_NS) return Promise.resolve();
    const h = normHolon(holon);
    const key = `${wireHolon(h)}|${lens}`;
    const existing = syncs.get(key);
    if (existing) return existing.promise;

    reverse?.ensure(h);
    const state = {
      key, holon: h, lens: String(lens), filter: filterFor(h, lens),
      sub: null, synced: false, reopenAttempts: 0, reopenTimer: null, promise: null,
    };
    syncs.set(key, state);
    state.promise = (async () => {
      const p = await poolReady;
      if (closed) return;
      const work = (async () => {
        const cursor = store.getCursor(h, lens);
        let newest = cursor?.since || 0;
        try {
          if (!cursor) newest = Math.max(newest, await backfill(p, state.filter));
          else newest = Math.max(newest, await catchUp(p, state.filter, Math.max(0, cursor.since - CATCHUP_OVERLAP_SEC)));
          if (!closed) {
            state.synced = true;
            store.setCursor(h, lens, newest);
          }
        } catch (e) {
          vlog('catch-up failed:', e?.message);
        }
        openLive(p, state, newest);
      })();
      await Promise.race([
        work,
        new Promise((resolve) => {
          const t = setTimeout(resolve, syncTimeoutMs);
          if (typeof t.unref === 'function') t.unref();
        }),
      ]);
    })();
    return state.promise;
  }

  /** Re-fetch every synced lens from its cursor (after a reconnect / on wake). */
  let resyncing = null;
  function resync() {
    if (closed || resyncing) return resyncing || Promise.resolve();
    resyncing = (async () => {
      const p = await poolReady;
      for (const state of Array.from(syncs.values())) {
        if (closed) break;
        const cursor = store.getCursor(state.holon, state.lens);
        const since = Math.max(0, (cursor?.since || 0) - CATCHUP_OVERLAP_SEC);
        try {
          const newest = await catchUp(p, state.filter, since);
          if (state.synced && newest) store.setCursor(state.holon, state.lens, newest);
        } catch (e) { vlog('resync failed:', e?.message); }
      }
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

  /** Publish already-signed events (any kind) to the relay set. */
  function publishEvents(events) {
    for (const e of Array.isArray(events) ? events : [events]) {
      if (e && e.id) publishEvent(e);
    }
  }

  /** Open a raw live REQ on the relay set. Returns a close function. */
  function subscribeRaw(filter, onevent) {
    let sub = null;
    let stopped = false;
    poolReady.then((p) => {
      if (closed || stopped) return;
      sub = p.subscribeMany(relays, filter, { onevent: (e) => { try { onevent(e); } catch { /* handler */ } } });
    }).catch(() => {});
    return () => { stopped = true; try { sub?.close(); } catch { /* ignore */ } };
  }

  return {
    pubkey,
    relays: [...relays],
    publishWrite,
    publishEvents,
    subscribeRaw,
    projector,
    reverse,
    publishDelete,
    ensureSync,
    resync,
    /** Test/diagnostic hook: number of live (holon, lens) subscriptions. */
    syncCount: () => syncs.size,
    /** Whether a lens finished its catch-up. */
    isSynced: (holon, lens) => !!syncs.get(`${wireHolon(holon)}|${lens}`)?.synced,
    close() {
      closed = true;
      reverse?.close();
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('online', onOnline);
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
      }
      for (const state of syncs.values()) {
        if (state.reopenTimer) clearTimeout(state.reopenTimer);
        try { state.sub?.close(); } catch { /* ignore */ }
      }
      syncs.clear();
      poolReady.then((p) => { try { p.close(relays); } catch { /* ignore */ } }).catch(() => {});
    },
  };
}

export default { createRelayTransport, GLOBAL_HOLON_TAG };
