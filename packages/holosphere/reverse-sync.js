// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Reverse sync — phase 2 of projections: fold EXTERNAL edits of the standard
// kinds we publish (NIP-52 31923/31922 + 31925 RSVPs, NIP-99 30402, kind 0,
// NIP-51 30003) back into the lens records they came from.
//
// The 30078 record stays canonical. An accepted standard event is a claim
// that is merged into the current record by the lens codec (`hook.parse` +
// `hook.merge`, see @holons/core/nostr) and then written through the normal
// put path — signed and published as OUR 30078, but with `_skipProjections`
// so the very event we ingested is not re-projected (no ratchet).
//
// Trust: only pubkeys returned by `trustedAuthors(holon)` (host-supplied —
// holon signer + members' derived keys + settings extras; default: own key ∪
// the sphere's read-list) may claim anything. RSVPs toggle the SIGNER's
// participation (the codec resolves the member from the pubkey); kind 0 is
// applied only to the signer's own user record.
//
// This module owns no subscription. It describes the REQ shapes a holon's
// external edits travel on (`liveFilters`), pulls them on demand through the
// transport's bounded `query` (`pull`, riding every read of the holon), and
// folds whatever the transport's live REQ hands it (`ingest`). The transport
// multiplexes those shapes into its one live REQ for watched holons.

import { verifyEvent, tag } from './nostr-events.js';

const DEFAULT_LOOKBACK_SEC = 7 * 24 * 3600;
const AUTHORS_CHUNK = 100;
const AUTHORS_TTL_MS = 5 * 60 * 1000;
const DEFAULT_FRESHNESS_MS = 3000;

/**
 * @param {object} holo HoloSphere instance
 * @param {object} opts
 * @param {(filter: object) => Promise<object[]>} opts.query bounded relay query (the transport's budgeted one)
 * @param {string[]} opts.relays
 * @param {object} opts.projector from createProjector (hooks + emitted ids)
 * @param {string} opts.pubkey own hex pubkey
 * @param {(holon: string) => (string[]|Promise<string[]>)} [opts.trustedAuthors]
 * @param {number} [opts.lookbackSec] cold-start catch-up window (default 7 d)
 * @param {number} [opts.freshnessMs] a holon pulled this recently is not pulled again
 * @param {boolean} [opts.verbose]
 */
export function createReverseSync(holo, {
  query, relays = [], projector, pubkey, trustedAuthors = null,
  lookbackSec = DEFAULT_LOOKBACK_SEC, freshnessMs = DEFAULT_FRESHNESS_MS, verbose = false,
} = {}) {
  const vlog = (...a) => { if (verbose) console.log('[reverse-sync]', ...a); };
  const hooks = projector?.hooks || new Map();
  const kinds = [...(projector?.kinds || [])];
  const parsers = [...hooks.values()].filter((h) => typeof h.parse === 'function' && typeof h.merge === 'function');
  const enabled = relays.length > 0 && kinds.length > 0 && parsers.length > 0 && typeof query === 'function';

  const seen = new Set();      // event ids already handled (incl. our own projections)
  const applied = new Map();   // "kind|address" -> created_at of the last accepted claim
  const chains = new Map();    // "lens|holon|id" -> tail promise (ordered apply)
  const holons = new Map();    // holon -> { authors, authorsAt, lastAt, freshAt, inflight }
  const trim = (m, cap) => { if (m.size > cap) m.delete(m.keys().next().value); };
  let closed = false;

  async function authorsFor(holon) {
    const own = new Set([pubkey, ...(holo._allowedAuthors || [])]);
    if (trustedAuthors) {
      try { for (const k of (await trustedAuthors(holon)) || []) if (k) own.add(String(k).toLowerCase()); }
      catch (e) { vlog('trustedAuthors failed:', e?.message); }
    }
    return [...own];
  }

  /** The record claim(s) an event makes: [{hook, reversed, holon}] — kind 0 fans out over known holons. */
  function claimsOf(event) {
    for (const hook of parsers) {
      let r = null;
      try { r = hook.parse(event); } catch (e) { vlog('parse failed:', hook.lens, e?.message); }
      if (!r) continue;
      if (r.holon) return [{ hook, reversed: r, holon: String(r.holon) }];
      return [...holons.keys()].map((holon) => ({ hook, reversed: r, holon }));
    }
    return [];
  }

  function applyKey(r, holon) {
    return (r.rsvp || r.reaction) ? `${r.kind}|${r.pubkey}|${r.lens}|${holon}|${r.id}`
      : r.kind === 0 ? `0|${r.pubkey}|${holon}`
        : `${r.kind}|${r.lens}|${holon}|${r.id}`;
  }

  async function ingest(event) {
    if (closed || !event || !event.id) return;
    // A kind 0 fans out over every holon known NOW; a holon learned later
    // (its first read) pulls the same event again and must not be refused —
    // the per-holon `applied` ratchet makes the repeat a no-op where it landed.
    if (event.kind !== 0 && seen.has(event.id)) return;
    seen.add(event.id);
    trim(seen, 20000);
    if (projector?.wasEmitted?.(event.id)) return;          // our own projection echo
    if (!kinds.includes(event.kind)) return;
    if (!verifyEvent(event)) { vlog('dropped forged event', event.id); return; }
    const claims = claimsOf(event);
    if (!claims.length) return;
    for (const { hook, reversed: r, holon } of claims) {
      const st = holons.get(holon);
      if (st && event.created_at > st.lastAt) st.lastAt = event.created_at;
      const trusted = await authorsFor(holon);
      if (!trusted.includes(String(event.pubkey).toLowerCase())) { vlog('untrusted author', event.pubkey.slice(0, 8), 'for', holon); continue; }
      const ak = applyKey(r, holon);
      if ((applied.get(ak) || 0) >= event.created_at) continue;   // stale or replayed claim
      applied.set(ak, event.created_at);
      trim(applied, 20000);
      // Keep our next projection of this address strictly newer than the edit.
      const d = r.kind === 0 ? event.pubkey : tag(event, 'd');
      if (!r.rsvp && !r.reaction && d) projector?.noteExternal?.(event.kind, d, event.created_at);
      const lk = `${r.lens}|${holon}|${r.id}`;
      const prev = chains.get(lk) || Promise.resolve();
      const next = prev.then(() => apply(hook, r, holon)).catch((e) => vlog('apply failed:', e?.message));
      chains.set(lk, next);
      next.finally(() => { if (chains.get(lk) === next) chains.delete(lk); });
      await next;
    }
  }

  async function apply(hook, r, holon) {
    // A private scope has no standard-kind twin to fold back: its projections
    // are never emitted, so an external edit of one is not ours to apply.
    if (holo.isPrivate?.(holon, r.lens, r.id)) { vlog('private scope, ignoring external edit', holon, r.lens, r.id); return; }
    let id = r.id;
    let current = await holo.get(holon, r.lens, id);
    // A kind 0 names a PERSON, not an address: in a key-founded holon their
    // record is keyed by the pubkey itself, while `userIdFor` answers with
    // the Telegram id their chats use. Try the key when the id has no record.
    if ((!current || typeof current !== 'object' || current._deleted) && r.kind === 0 && r.pubkey && String(r.pubkey) !== String(id)) {
      const byKey = await holo.get(holon, r.lens, r.pubkey);
      if (byKey && typeof byKey === 'object' && !byKey._deleted) { id = r.pubkey; current = byKey; }
    }
    if (!current || typeof current !== 'object' || current._deleted) { vlog('no record for claim', holon, r.lens, r.id); return; }
    let next = null;
    try { next = hook.merge(current, r); } catch (e) { vlog('merge failed:', e?.message); return; }
    if (!next) return;
    if (next.id === undefined || next.id === null) next.id = id;
    await holo.put(holon, r.lens, next, null, { _skipProjections: true, disableHologramRedirection: true });
    vlog('applied', `${holon}/${r.lens}/${id}`, 'kind', r.kind, 'by', r.pubkey.slice(0, 8));
  }

  /**
   * Register a holon (sync, no network). Reverse sync knows a holon from the
   * first read or watch of it; kind-0 claims fan out over every known holon.
   */
  function ensure(holon) {
    if (!enabled || closed || holon === null || holon === undefined) return null;
    const h = String(holon);
    let st = holons.get(h);
    if (!st) {
      st = { authors: [], authorsAt: 0, lastAt: 0, freshAt: 0, inflight: null };
      holons.set(h, st);
    }
    return st;
  }

  /**
   * The REQ shapes that carry a holon's external edits:
   *   1. clients that keep our tags (Elinor grammar: t=group-<holon>)
   *   2. clients that rebuild tags: anything by a trusted author (kind 0
   *      rides here only), chunked so one filter never carries hundreds of
   *      keys.
   * `since` is the lookback on first contact, then just past what was seen.
   */
  async function filtersFor(holon) {
    const st = ensure(holon);
    if (!st) return [];
    if (Date.now() - st.authorsAt > AUTHORS_TTL_MS) {
      st.authors = await authorsFor(holon);
      st.authorsAt = Date.now();
    }
    const now = Math.floor(Date.now() / 1000);
    const floor = Math.max(0, now - lookbackSec);
    const since = st.lastAt ? Math.max(floor, st.lastAt - 60) : floor;
    const h = String(holon);
    const out = [{ kinds, '#t': [`group-${h}`], since }];
    for (let i = 0; i < st.authors.length; i += AUTHORS_CHUNK) {
      out.push({ kinds, authors: st.authors.slice(i, i + AUTHORS_CHUNK), since });
    }
    return out;
  }

  /** One bounded catch-up of a holon's external edits (no subscription). */
  function pull(holon) {
    const st = ensure(holon);
    if (!st) return Promise.resolve();
    if (st.inflight) return st.inflight;
    if (Date.now() - st.freshAt < freshnessMs) return Promise.resolve();
    st.inflight = (async () => {
      for (const filter of await filtersFor(holon)) {
        if (closed) return;
        const events = await query(filter);
        events.sort((a, b) => a.created_at - b.created_at);
        for (const e of events) {
          if (e.created_at > st.lastAt) st.lastAt = e.created_at;
          await ingest(e);
        }
      }
      if (!closed) st.freshAt = Date.now();
    })().catch((e) => vlog('pull failed:', holon, e?.message)).finally(() => { st.inflight = null; });
    return st.inflight;
  }

  return {
    enabled,
    ensure,
    pull,
    /** Filters for the transport's live REQ (a watched holon). */
    liveFilters: filtersFor,
    ingest,
    holons: () => [...holons.keys()],
    close() {
      closed = true;
      holons.clear();
    },
  };
}

export default { createReverseSync };
