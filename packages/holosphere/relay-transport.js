/**
 * Nostr relay transport for HoloSphere — `backend: 'nostr'`.
 *
 * In this mode the relay IS the wire: Gun stays as the local-first cache
 * (peerless — in-memory graph + radisk), and ALL networking happens over the
 * Nostr relay(s):
 *
 *   write  →  every non-private put/delete is published as a signed NIP-01
 *             event (kind 30078, NIP-33 replaceable per location) — including
 *             holograms and globals, which the signing layer deliberately
 *             skips.
 *   read   →  `ensureSync(holon, lens)` opens ONE live REQ per (holon, lens)
 *             and resolves at EOSE, so a cold read sees the relay's current
 *             state; the subscription stays open and keeps feeding remote
 *             events into the local graph (which fires normal subscribers).
 *
 * Every ingested event is signature-verified and also mirrored into the
 * `_events` envelope sidecar, so shadow/enforce-mode reads authorize remote
 * data exactly like local signed writes.
 *
 * Event scheme (matches nostr-events.js / the signing layer):
 *   tags [["h", holon], ["l", lens], ["d", "holon/lens/id"], ["n", appname]]
 * The `n` (namespace) tag scopes events to one app namespace so `Holons` and
 * `HolonsDebug` can share a relay without bleeding into each other; globals
 * (holon == null) use the sentinel `h` value below.
 */

import {
  buildEvent,
  verifyEvent,
  eventToItem,
  getPublicKey,
  tag,
  HOLOSPHERE_KIND,
} from './nostr-events.js';
import { createProjector } from './projections.js';
import { createReverseSync } from './reverse-sync.js';

/** `h`-tag sentinel for holon-less (global) records — `app/table/key`. */
export const GLOBAL_HOLON_TAG = '_g';

const EVENTS_NS = '_events';

/** How long a cold read waits for the relay's EOSE before proceeding with
 *  whatever is local. The live subscription keeps catching up afterwards. */
const DEFAULT_SYNC_TIMEOUT_MS = 5000;

/** Reconnect backoff for a dropped relay subscription. */
const RESUBSCRIBE_DELAY_MS = 3000;

export function createRelayTransport(holo, {
  relays = [],
  privateKey,
  kind = HOLOSPHERE_KIND,
  syncTimeoutMs = DEFAULT_SYNC_TIMEOUT_MS,
  verbose = false,
  // Standard-kind projections (see projections.js / @holons/core/nostr).
  projections = [],
  signerFor = null,
  // Reverse sync of external standard-kind edits (see reverse-sync.js).
  reverseSync = true,
  trustedAuthors = null,
  reverseLookbackSec,
} = {}) {
  if (!relays.length) throw new Error('relay-transport: at least one relay is required');
  if (!privateKey) throw new Error('relay-transport: a privateKey is required');

  const pubkey = getPublicKey(privateKey);
  const app = holo.appname;
  const vlog = (...a) => { if (verbose) console.log('[nostr-transport]', ...a); };
  const projector = createProjector({ projections, privateKey, signerFor, verbose });

  let pool = null;
  let closed = false;
  const poolReady = import('nostr-tools/pool').then(({ SimplePool }) => {
    pool = new SimplePool();
    return pool;
  });
  const reverse = reverseSync && projector.enabled
    ? createReverseSync(holo, { poolReady, relays, projector, pubkey, trustedAuthors, lookbackSec: reverseLookbackSec, verbose })
    : null;

  // ---- loop / ordering guards ------------------------------------------------
  // Applied wire state per location: skip events at-or-older than what we've
  // already ingested, and skip our own events entirely (they were written
  // locally before publishing). `seen` dedups the cold-query/live overlap.
  const applied = new Map();   // "holon|lens|id" -> created_at of last applied event
  const seen = new Set();      // event ids already processed
  const chains = new Map();    // "holon|lens|id" -> tail promise (ordered apply)
  const trim = (m, cap) => { if (m.size > cap) m.delete(m.keys().next().value); };

  const locKey = (holon, lens, id) => `${holon ?? GLOBAL_HOLON_TAG}|${lens}|${id}`;

  // ---- publishing ------------------------------------------------------------

  function publishEvent(event) {
    if (closed || !event) return;
    poolReady
      .then((p) => Promise.allSettled(p.publish(relays, event)))
      .then((r) => {
        if (!r.some((x) => x.status === 'fulfilled')) {
          vlog('publish reached no relay:', event.id);
        }
      })
      .catch((e) => vlog('publish failed:', e?.message));
  }

  function buildFor(holon, lens, item) {
    return buildEvent({
      holon: holon == null ? GLOBAL_HOLON_TAG : String(holon),
      lens,
      item,
      sk: privateKey,
      kind,
      extraTags: [['n', app]],
    });
  }

  /**
   * Publish a write to the relay(s). Fire-and-forget — never blocks the put.
   * When the signing layer already issued the envelope event for this write,
   * pass it as `signedEvent` so the wire carries the exact event the local
   * envelope store attests (no double signing).
   */
  function publishWrite(holon, lens, item, { key, signedEvent, skipProjections = false } = {}) {
    if (closed) return;
    try {
      const addressed = withId(item, key);
      const event = signedEvent || (addressed && buildFor(holon, lens, addressed));
      if (!event) return;
      // Our own writes are already local — remember them so the live REQ echo
      // is dropped without re-applying.
      seen.add(event.id);
      trim(seen, 20000);
      const id = addressed?.id;
      if (id != null) {
        const lk = locKey(holon, lens, String(id));
        applied.set(lk, Math.max(applied.get(lk) || 0, event.created_at));
        trim(applied, 20000);
      }
      publishEvent(event);
      // Standard-kind projections ride alongside; never ingested back here (see
      // ingest) — external edits of them arrive via reverse-sync.js, and a write
      // that folds such an edit in must not re-project it (`skipProjections`).
      if (skipProjections) return;
      for (const p of projector.eventsForWrite(holon, lens, addressed)) {
        seen.add(p.id);
        publishEvent(p);
      }
    } catch (e) {
      vlog('publishWrite failed:', e?.message);
    }
  }

  /** Publish a signed tombstone so the delete travels the wire. When the
   *  signing layer already issued the tombstone envelope, pass it so the wire
   *  carries that exact event. */
  function publishDelete(holon, lens, key, signedEvent = null) {
    if (closed || key == null) return;
    publishWrite(holon, lens, { id: String(key), _deleted: true }, { signedEvent });
    for (const p of projector.eventsForDelete(holon, lens, key)) {
      seen.add(p.id);
      publishEvent(p);
    }
  }

  function withId(item, key) {
    if (!item) return null;
    if (item.id != null) return item;
    if (key == null) return null; // nothing addressable to replace on the relay
    return { ...item, id: String(key) };
  }

  // ---- ingesting -------------------------------------------------------------

  function envelopeWrite(holon, lens, id, event) {
    // Mirror the wire event into the `_events` sidecar (same slot the signing
    // layer uses) so shadow/enforce reads can authorize remote data.
    try {
      holo.gun.get(app).get(holon).get(EVENTS_NS).get(lens).get(id)
        .get(event.pubkey).put(JSON.stringify(event));
    } catch { /* best-effort */ }
  }

  function ingest(event) {
    if (closed || !event || seen.has(event.id)) return Promise.resolve();
    seen.add(event.id);
    trim(seen, 20000);
    if (event.kind !== kind) return Promise.resolve(); // projected/other kinds are never ingested
    if (event.pubkey === pubkey) return Promise.resolve(); // our own write — already local
    if (!verifyEvent(event)) { vlog('dropped forged event', event.id); return Promise.resolve(); }
    if (tag(event, 'n') !== app) return Promise.resolve(); // another app namespace

    const h = tag(event, 'h');
    const lens = tag(event, 'l');
    const item = eventToItem(event);
    if (!h || !lens || !item || item.id == null) return Promise.resolve();
    const holon = h === GLOBAL_HOLON_TAG ? null : h;

    const lk = locKey(holon, lens, String(item.id));
    // created_at has second granularity — an equal timestamp is NOT stale
    // (create-then-update within one second is common); apply in arrival
    // order and let the newest write win. Only strictly-older events drop.
    if ((applied.get(lk) || 0) > event.created_at) return Promise.resolve(); // stale
    applied.set(lk, event.created_at);
    trim(applied, 20000);

    // Ordered apply per location so an interleaved pair of awaited puts can't
    // land newest-first.
    const prev = chains.get(lk) || Promise.resolve();
    const next = prev.then(async () => {
      if (holon != null) envelopeWrite(holon, lens, String(item.id), event);
      // Raw local write: no re-sign (the wire event IS the signature), no
      // re-publish (would echo someone else's record under our key), no
      // federation propagation (the author's transport already published to
      // the shared wire), no hologram redirection (place the record verbatim
      // where the author put it).
      await holo.put(holon, lens, item, null, {
        _skipSign: true,
        _skipPublish: true,
        autoPropagate: false,
        disableHologramRedirection: true,
      });
      vlog('ingested', `${holon ?? GLOBAL_HOLON_TAG}/${lens}/${item.id}`, item._deleted ? '(tombstone)' : '');
    }).catch((e) => vlog('ingest failed:', e?.message));
    chains.set(lk, next);
    next.finally(() => { if (chains.get(lk) === next) chains.delete(lk); });
    return next;
  }

  // ---- live sync per (holon, lens) ------------------------------------------

  const syncs = new Map(); // "holon|lens" -> { promise, sub, lastAt }

  function filterFor(holon, lens) {
    return {
      kinds: [kind],
      '#h': [holon == null ? GLOBAL_HOLON_TAG : String(holon)],
      '#l': [lens],
      '#n': [app],
    };
  }

  /**
   * Open (once) a live relay subscription for a (holon, lens) and return a
   * promise that resolves after the initial catch-up (EOSE + ingest settle),
   * bounded by `syncTimeoutMs` so an unreachable relay never blocks reads.
   * The subscription stays open; remote events keep flowing into Gun.
   */
  function ensureSync(holon, lens) {
    if (closed || !lens || String(lens) === EVENTS_NS) return Promise.resolve();
    const key = `${holon ?? GLOBAL_HOLON_TAG}|${lens}`;
    const existing = syncs.get(key);
    if (existing) return existing.promise;

    reverse?.ensure(holon);
    const state = { sub: null, lastAt: 0, promise: null };
    state.promise = (async () => {
      const p = await poolReady;
      if (closed) return;
      await new Promise((resolve) => {
        let settled = false;
        const pending = [];
        const finish = () => { if (!settled) { settled = true; resolve(); } };
        const deadline = setTimeout(finish, syncTimeoutMs);
        if (typeof deadline.unref === 'function') deadline.unref();

        const open = (since) => {
          const filter = since ? { ...filterFor(holon, lens), since } : filterFor(holon, lens);
          // nostr-tools 2.x subscribeMany takes ONE filter (not an array).
          state.sub = p.subscribeMany(relays, filter, {
            onevent: (evt) => {
              state.lastAt = Math.max(state.lastAt, evt.created_at || 0);
              const p = ingest(evt);
              // Track only the initial catch-up; a long-lived sub must not
              // accumulate a promise per live event forever.
              if (!settled) pending.push(p);
            },
            oneose: () => {
              Promise.allSettled(pending).then(() => { clearTimeout(deadline); finish(); });
            },
            onclose: (reasons) => {
              // A dropped wire (relay restart, network blip) closes the sub —
              // reopen with a `since` catch-up so nothing published meanwhile
              // is missed. Caller-initiated close() sets `closed` first.
              if (closed || !syncs.has(key)) return;
              const callerClosed = (reasons || []).every((r) => /closed by caller/i.test(String(r)));
              if (callerClosed) return;
              const t = setTimeout(() => {
                if (!closed && syncs.has(key)) open(Math.max(0, state.lastAt - 60));
              }, RESUBSCRIBE_DELAY_MS);
              if (typeof t.unref === 'function') t.unref();
            },
          });
        };
        open();
      });
    })();
    syncs.set(key, state);
    return state.promise;
  }

  return {
    pubkey,
    relays: [...relays],
    publishWrite,
    projector,
    reverse,
    publishDelete,
    ensureSync,
    /** Test/diagnostic hook: number of live (holon, lens) subscriptions. */
    syncCount: () => syncs.size,
    close() {
      closed = true;
      reverse?.close();
      for (const { sub } of syncs.values()) { try { sub?.close(); } catch { /* ignore */ } }
      syncs.clear();
      poolReady.then((p) => { try { p.close(relays); } catch { /* ignore */ } }).catch(() => {});
    },
  };
}

export default { createRelayTransport, GLOBAL_HOLON_TAG };
