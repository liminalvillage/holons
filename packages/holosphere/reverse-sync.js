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
// One instance serves both wires: the nostr-backend transport and the
// relay-backup signer each create one on their own pool.

import { verifyEvent, tag } from './nostr-events.js';

const RESUBSCRIBE_DELAY_MS = 3000;
const DEFAULT_LOOKBACK_SEC = 7 * 24 * 3600;
const AUTHORS_CHUNK = 100;

/**
 * @param {object} holo HoloSphere instance
 * @param {object} opts
 * @param {Promise<object>} opts.poolReady resolves to a nostr-tools SimplePool
 * @param {string[]} opts.relays
 * @param {object} opts.projector from createProjector (hooks + emitted ids)
 * @param {string} opts.pubkey own hex pubkey
 * @param {(holon: string) => (string[]|Promise<string[]>)} [opts.trustedAuthors]
 * @param {number} [opts.lookbackSec] cold-start catch-up window (default 7 d)
 * @param {boolean} [opts.verbose]
 */
export function createReverseSync(holo, {
  poolReady, relays = [], projector, pubkey, trustedAuthors = null,
  lookbackSec = DEFAULT_LOOKBACK_SEC, verbose = false,
} = {}) {
  const vlog = (...a) => { if (verbose) console.log('[reverse-sync]', ...a); };
  const hooks = projector?.hooks || new Map();
  const kinds = [...(projector?.kinds || [])];
  const parsers = [...hooks.values()].filter((h) => typeof h.parse === 'function' && typeof h.merge === 'function');
  const enabled = relays.length > 0 && kinds.length > 0 && parsers.length > 0;

  const seen = new Set();      // event ids already handled (incl. our own projections)
  const applied = new Map();   // "kind|address" -> created_at of the last accepted claim
  const chains = new Map();    // "lens|holon|id" -> tail promise (ordered apply)
  const subs = new Map();      // holon -> { subs: [], lastAt }
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

  /** The record claim(s) an event makes: [{hook, reversed, holon}] — kind 0 fans out over ensured holons. */
  function claimsOf(event) {
    for (const hook of parsers) {
      let r = null;
      try { r = hook.parse(event); } catch (e) { vlog('parse failed:', hook.lens, e?.message); }
      if (!r) continue;
      if (r.holon) return [{ hook, reversed: r, holon: String(r.holon) }];
      return [...subs.keys()].map((holon) => ({ hook, reversed: r, holon }));
    }
    return [];
  }

  function applyKey(r, holon) {
    return (r.rsvp || r.reaction) ? `${r.kind}|${r.pubkey}|${r.lens}|${holon}|${r.id}`
      : r.kind === 0 ? `0|${r.pubkey}`
        : `${r.kind}|${r.lens}|${holon}|${r.id}`;
  }

  async function ingest(event) {
    if (closed || !event || !event.id || seen.has(event.id)) return;
    seen.add(event.id);
    trim(seen, 20000);
    if (projector?.wasEmitted?.(event.id)) return;          // our own projection echo
    if (!kinds.includes(event.kind)) return;
    if (!verifyEvent(event)) { vlog('dropped forged event', event.id); return; }
    const claims = claimsOf(event);
    if (!claims.length) return;
    for (const { hook, reversed: r, holon } of claims) {
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
    const current = await holo.get(holon, r.lens, r.id);
    if (!current || typeof current !== 'object' || current._deleted) { vlog('no record for claim', holon, r.lens, r.id); return; }
    let next = null;
    try { next = hook.merge(current, r); } catch (e) { vlog('merge failed:', e?.message); return; }
    if (!next) return;
    await holo.put(holon, r.lens, next, null, { _skipProjections: true, disableHologramRedirection: true });
    vlog('applied', `${holon}/${r.lens}/${r.id}`, 'kind', r.kind, 'by', r.pubkey.slice(0, 8));
  }

  function open(p, holon, state, filter, key) {
    const sub = p.subscribeMany(relays, filter, {
      onevent: (evt) => {
        state.lastAt = Math.max(state.lastAt, evt.created_at || 0);
        ingest(evt).catch(() => {});
      },
      onclose: (reasons) => {
        if (closed || !subs.has(holon)) return;
        if ((reasons || []).every((r) => /closed by caller/i.test(String(r)))) return;
        const t = setTimeout(() => {
          if (closed || !subs.has(holon)) return;
          state.subs[key] = open(p, holon, state, { ...filter, since: Math.max(0, state.lastAt - 60) }, key);
        }, RESUBSCRIBE_DELAY_MS);
        if (typeof t.unref === 'function') t.unref();
      },
    });
    return sub;
  }

  /** Open (once) the live subscriptions for a holon. Never throws, never blocks. */
  function ensure(holon) {
    if (!enabled || closed || holon === null || holon === undefined) return;
    const h = String(holon);
    if (subs.has(h)) return;
    const state = { subs: {}, lastAt: 0 };
    subs.set(h, state);
    (async () => {
      const p = await poolReady;
      if (closed || !subs.has(h)) return;
      const since = Math.max(0, Math.floor(Date.now() / 1000) - lookbackSec);
      // 1. clients that keep our tags (Elinor grammar: t=group-<holon>)
      state.subs.group = open(p, h, state, { kinds, '#t': [`group-${h}`], since }, 'group');
      // 2. clients that rebuild tags: anything by a trusted author (kind 0 rides here only)
      const authors = await authorsFor(h);
      for (let i = 0; i < authors.length; i += AUTHORS_CHUNK) {
        const chunk = authors.slice(i, i + AUTHORS_CHUNK);
        state.subs[`authors${i}`] = open(p, h, state, { kinds, authors: chunk, since }, `authors${i}`);
      }
    })().catch((e) => vlog('ensure failed:', e?.message));
  }

  return {
    enabled,
    ensure,
    ingest,
    holons: () => [...subs.keys()],
    close() {
      closed = true;
      for (const { subs: s } of subs.values()) for (const sub of Object.values(s)) { try { sub?.close(); } catch { /* ignore */ } }
      subs.clear();
    },
  };
}

export default { createReverseSync };
