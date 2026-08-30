// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Standard-kind PROJECTIONS of HoloSphere writes.
//
// The canonical wire record stays the kind-30078 event built by
// nostr-events.js. When a lens has a registered projection hook (see
// @holons/core/nostr), every publish additionally emits the lens's standard
// Nostr kind (NIP-52 calendar, NIP-99 classified, kind-0 profile, NIP-51
// set) and every delete emits a NIP-09 retraction — so third-party clients
// can read Holons data without knowing HoloSphere. One-way: projected kinds
// are never ingested and never enter the `_events` envelope sidecar.
//
// Hook shape (framework-free, supplied by the host):
//   { lens, kinds, requiresAuthor?, project(holon, lens, item) -> {primary, companions?} | null,
//     retract(holon, lens, id) -> template[] }

import { signEvent, getPublicKey } from './nostr-events.js';

/**
 * @param {object} opts
 * @param {Array} [opts.projections] hooks as above
 * @param {string|Uint8Array} opts.privateKey holon signing key
 * @param {(userId: string|number) => (string|Uint8Array|null|undefined)} [opts.signerFor]
 *        per-user key lookup; needed for kind 0 and RSVP companions
 * @param {boolean} [opts.verbose]
 */
export function createProjector({ projections = [], privateKey, signerFor = null, verbose = false } = {}) {
  const hooks = new Map();
  const kinds = new Set();
  for (const h of projections || []) {
    if (!h || !h.lens || typeof h.project !== 'function') continue;
    hooks.set(String(h.lens), h);
    for (const k of h.kinds || []) kinds.add(k);
  }
  const vlog = (...a) => { if (verbose) console.log('[projections]', ...a); };
  // Relays replace addressable events by created_at (second granularity):
  // keep every (kind, d | pubkey) strictly monotone across rapid re-puts.
  const lastAt = new Map();
  const trim = (m, cap) => { if (m.size > cap) m.delete(m.keys().next().value); };

  const dTag = (t) => (t.tags || []).find((x) => x[0] === 'd')?.[1];

  function sign(template, sk) {
    const key = `${template.kind}|${dTag(template) ?? getPublicKey(sk)}`;
    const prev = lastAt.get(key) || 0;
    const created_at = Math.max(template.created_at || 0, prev + 1, Math.floor(Date.now() / 1000));
    lastAt.set(key, created_at);
    trim(lastAt, 20000);
    return signEvent({ ...template, created_at }, sk);
  }

  function userKey(userId) {
    if (!signerFor || userId === undefined || userId === null) return null;
    try { return signerFor(userId) || null; } catch { return null; }
  }

  function skip(holon, item) {
    return holon === null || holon === undefined || !item || typeof item !== 'object'
      || item._deleted || item._hologram || item._federation;
  }

  /** Signed standard-kind events for a write; [] when nothing applies. */
  function eventsForWrite(holon, lens, item) {
    const hook = hooks.get(String(lens));
    if (!hook || skip(holon, item)) return [];
    let out;
    try { out = hook.project(String(holon), String(lens), item); } catch (e) { vlog('project failed:', lens, e?.message); return []; }
    if (!out || !out.primary) return [];
    const events = [];
    try {
      const primarySk = hook.requiresAuthor === 'user' ? userKey(item.id) : privateKey;
      if (primarySk) events.push(sign(out.primary, primarySk));
      else vlog('no user key for', lens, item.id, '— primary dropped');
      for (const c of out.companions || []) {
        const sk = c.authorHint ? userKey(c.authorHint.userId) : privateKey;
        if (sk) events.push(sign(c.template, sk));
      }
    } catch (e) { vlog('sign failed:', lens, e?.message); }
    return events;
  }

  /** Signed NIP-09 retractions for a delete; [] when the lens has no projection. */
  function eventsForDelete(holon, lens, id) {
    const hook = hooks.get(String(lens));
    if (!hook || holon === null || holon === undefined || id === null || id === undefined) return [];
    try {
      return (hook.retract(String(holon), String(lens), String(id)) || []).map((t) => sign(t, privateKey));
    } catch (e) { vlog('retract failed:', lens, e?.message); return []; }
  }

  return {
    eventsForWrite,
    eventsForDelete,
    kinds,
    lenses: [...hooks.keys()],
    get enabled() { return hooks.size > 0; },
  };
}
