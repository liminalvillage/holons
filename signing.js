/**
 * Phase 1 signing layer for HoloSphere — sign-on-write + dual-publish to Nostr
 * relay(s), local signed-envelope storage, relay-backed recover, relay
 * migration, and shadow-mode read verification.
 *
 * Opt-in: nothing here runs unless you call `sphere.enableSigning(...)`. This
 * module is loaded dynamically, so `nostr-tools` is only needed when signing is
 * enabled (it is otherwise an optional dependency).
 *
 * Phase 1 is NON-breaking: the Gun store still holds raw items at their normal
 * path; signed events are published to the relay and (in shadow/storeEnvelope
 * mode) ALSO written to a reserved `_events` sidecar that ordinary reads never
 * touch. Shadow mode measures the forgery surface (how much data would be
 * dropped by Phase 2 authorized-read) WITHOUT changing what `getAll` returns.
 *
 * See NOSTR-SIGNING-PLAN.md.
 */

import {
  buildEvent,
  verifyEvent,
  eventToItem,
  getPublicKey,
  HOLOSPHERE_KIND,
} from './nostr-events.js';

const EVENTS_NS = '_events'; // reserved holon child: appname/holon/_events/lens/itemId/pubkey

function freshReport() {
  return {
    reads: 0,          // getAll/audit passes
    items: 0,          // items inspected
    accounted: 0,      // backed by a valid signed event matching the item
    wouldDrop: 0,      // unsigned + mismatch + invalidSig (Phase 2 would hide these)
    unsigned: 0,       // no signed event present
    invalidSig: 0,     // event(s) present, none verify
    mismatch: 0,       // valid event(s) present, none match this item's id
    byPubkey: {},      // pubkey -> count of accounted items
  };
}

export async function createSigner({
  privateKey, relays = [], kind = HOLOSPHERE_KIND, verbose = false,
  shadow = false, storeEnvelope,
}) {
  if (!privateKey) throw new Error('enableSigning: a privateKey is required');
  const { SimplePool } = await import('nostr-tools/pool');

  const pool = new SimplePool();
  let relayList = [...relays];
  const pubkey = getPublicKey(privateKey);
  const envelope = storeEnvelope ?? shadow; // shadow needs local envelopes to verify against
  const report = freshReport();
  const vlog = (...a) => { if (verbose) console.log('[signing]', ...a); };

  // --- Gun sidecar I/O (reserved _events namespace; reads never see it) -------
  function envelopeNode(holo, holon, lens, itemId) {
    return holo.gun.get(holo.appname).get(holon).get(EVENTS_NS).get(lens).get(itemId);
  }
  function writeEnvelope(holo, holon, lens, itemId, event) {
    return new Promise((resolve) => {
      let settled = false;
      const done = () => { if (!settled) { settled = true; resolve(); } };
      setTimeout(done, 3000);
      try { envelopeNode(holo, holon, lens, itemId).get(event.pubkey).put(JSON.stringify(event), () => done()); }
      catch { done(); }
    });
  }
  function readEnvelopes(holo, holon, lens, itemId) {
    return new Promise((resolve) => {
      const out = [];
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(out); } };
      const t = setTimeout(finish, 2500);
      const node = envelopeNode(holo, holon, lens, itemId);
      node.once((data) => {
        if (!data) { clearTimeout(t); return finish(); }
        const keys = Object.keys(data).filter((k) => k !== '_');
        if (!keys.length) { clearTimeout(t); return finish(); }
        let received = 0;
        node.map().once((evtData, key) => {
          received++;
          if (evtData && key !== '_') {
            try { out.push(typeof evtData === 'string' ? JSON.parse(evtData) : evtData); } catch { /* skip */ }
          }
          if (received >= keys.length) { clearTimeout(t); finish(); }
        });
      });
    });
  }

  const signer = {
    pubkey,
    shadow,
    get relays() { return [...relayList]; },
    setRelays(next) { relayList = [...next]; },
    addRelay(url) { if (!relayList.includes(url)) relayList.push(url); },
    getReport() { return { ...report, byPubkey: { ...report.byPubkey } }; },
    resetReport() { Object.assign(report, freshReport()); },

    /**
     * Sign an item, publish to relays, and (in envelope mode) store the signed
     * event in the local Gun sidecar. Safe to call fire-and-forget.
     */
    async onWrite(holo, holon, lens, item) {
      try {
        if (!item || !item.id) return { published: 0 };
        if (!relayList.length && !envelope) return { published: 0 };
        const event = buildEvent({ holon, lens, item, sk: privateKey, kind });
        let ok = 0;
        if (relayList.length) {
          const results = await Promise.allSettled(pool.publish(relayList, event));
          ok = results.filter((r) => r.status === 'fulfilled').length;
        }
        if (envelope && holo) await writeEnvelope(holo, holon, lens, item.id, event);
        vlog(`signed ${event.id.slice(0, 8)}… → ${ok}/${relayList.length} relay(s)${envelope ? ' + gun envelope' : ''}`);
        return { published: ok, id: event.id, stored: !!envelope };
      } catch (e) {
        vlog('onWrite failed:', e?.message);
        return { published: 0, error: e?.message };
      }
    },

    /**
     * Shadow verification: classify each item against its local signed
     * envelope(s). Updates the cumulative report and returns a per-call summary.
     * Does NOT modify or filter `items` — measurement only.
     */
    async shadowCheck(holo, holon, lens, items) {
      const call = { items: 0, accounted: 0, wouldDrop: 0, unsigned: 0, invalidSig: 0, mismatch: 0 };
      if (!Array.isArray(items) || !items.length) return call;
      report.reads++;
      for (const item of items) {
        if (!item || !item.id) continue;
        call.items++; report.items++;
        const events = await readEnvelopes(holo, holon, lens, item.id);
        const valid = events.filter(verifyEvent);
        if (valid.some((e) => eventToItem(e)?.id === item.id)) {
          call.accounted++; report.accounted++;
          for (const e of valid) report.byPubkey[e.pubkey] = (report.byPubkey[e.pubkey] || 0) + 1;
        } else if (valid.length) {
          call.mismatch++; report.mismatch++; call.wouldDrop++; report.wouldDrop++;
        } else if (events.length) {
          call.invalidSig++; report.invalidSig++; call.wouldDrop++; report.wouldDrop++;
        } else {
          call.unsigned++; report.unsigned++; call.wouldDrop++; report.wouldDrop++;
        }
      }
      if (call.wouldDrop > 0) {
        console.log(`[signing:shadow] ${holon}/${lens}: ${call.items} items, ${call.accounted} accounted, ${call.wouldDrop} would-drop (unsigned ${call.unsigned}, mismatch ${call.mismatch}, invalid-sig ${call.invalidSig})`);
      }
      return call;
    },

    /** Query relays for a holon/lens; return only signature-valid events. */
    async fetch(holon, lens, { relays: from = relayList } = {}) {
      if (!from.length) return [];
      const events = await pool.querySync(from, { kinds: [kind], '#h': [holon], '#l': [lens] });
      return events.filter(verifyEvent);
    },

    /** Recover a holon/lens from the relays into the local Gun store. */
    async rehydrate(holoInstance, holon, lens, opts = {}) {
      const events = await signer.fetch(holon, lens, opts);
      let restored = 0;
      for (const evt of events) {
        const item = eventToItem(evt);
        if (!item || !item.id) continue;
        await holoInstance.put(holon, lens, item, null, { _skipSign: true, autoPropagate: false });
        restored++;
      }
      vlog(`rehydrated ${restored}/${events.length} item(s) for ${holon}/${lens}`);
      return { found: events.length, restored };
    },

    /**
     * Move your data between relays by republishing your signed events verbatim
     * (signatures stay valid, ids dedup). With no filter, `authors:[you]`
     * fetches ALL your data across every holon/lens.
     */
    async migrate({ to, from = relayList, authors = [pubkey], filter = {}, switch: doSwitch = false }) {
      if (!to || !to.length) throw new Error('migrate: `to` relays are required');
      const events = (await pool.querySync(from, { authors, ...filter })).filter(verifyEvent);
      let moved = 0;
      for (const evt of events) {
        const r = await Promise.allSettled(pool.publish(to, evt));
        if (r.some((x) => x.status === 'fulfilled')) moved++;
      }
      vlog(`migrated ${moved}/${events.length} event(s) from ${from.length} → ${to.length} relay(s)`);
      if (doSwitch && moved > 0) relayList = [...to];
      return { total: events.length, moved, switched: doSwitch && moved > 0 };
    },

    close() { try { pool.close(relayList); } catch { /* ignore */ } },
  };

  return signer;
}
