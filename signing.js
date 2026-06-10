/**
 * Phase 1 signing layer for HoloSphere — sign-on-write + dual-publish to Nostr
 * relay(s), plus relay-backed recover and relay migration.
 *
 * Opt-in: nothing here runs unless you call `sphere.enableSigning(...)`. This
 * module is loaded dynamically, so `nostr-tools` is only needed when signing is
 * enabled (it is otherwise an optional dependency).
 *
 * See NOSTR-SIGNING-PLAN.md. Phase 1 is intentionally NON-breaking: the Gun
 * store still holds raw items; the signed event is published to the relay
 * alongside. Authorized read-collapse (envelope-in-Gun) is Phase 2.
 */

import {
  buildEvent,
  verifyEvent,
  eventToItem,
  getPublicKey,
  HOLOSPHERE_KIND,
} from './nostr-events.js';

/**
 * @param {object} cfg
 * @param {string|Uint8Array} cfg.privateKey - author secret key
 * @param {string[]} [cfg.relays] - ws(s):// relay URLs
 * @param {number} [cfg.kind]
 * @param {boolean} [cfg.verbose]
 */
export async function createSigner({ privateKey, relays = [], kind = HOLOSPHERE_KIND, verbose = false }) {
  if (!privateKey) throw new Error('enableSigning: a privateKey is required');
  const { SimplePool } = await import('nostr-tools/pool');

  const pool = new SimplePool();
  let relayList = [...relays];
  const pubkey = getPublicKey(privateKey);
  const vlog = (...a) => { if (verbose) console.log('[signing]', ...a); };

  const signer = {
    pubkey,
    get relays() { return [...relayList]; },
    setRelays(next) { relayList = [...next]; },
    addRelay(url) { if (!relayList.includes(url)) relayList.push(url); },

    /**
     * Sign an item and publish it to the relays. Safe to call fire-and-forget:
     * it never throws into the caller's write path.
     */
    async onWrite(holon, lens, item) {
      try {
        if (!relayList.length || !item || !item.id) return { published: 0 };
        const event = buildEvent({ holon, lens, item, sk: privateKey, kind });
        const results = await Promise.allSettled(pool.publish(relayList, event));
        const ok = results.filter((r) => r.status === 'fulfilled').length;
        vlog(`published ${event.id.slice(0, 8)}… to ${ok}/${relayList.length} relay(s)`);
        return { published: ok, id: event.id };
      } catch (e) {
        vlog('onWrite failed:', e?.message);
        return { published: 0, error: e?.message };
      }
    },

    /** Query relays for a holon/lens; return only signature-valid events. */
    async fetch(holon, lens, { relays: from = relayList } = {}) {
      if (!from.length) return [];
      const events = await pool.querySync(from, { kinds: [kind], '#h': [holon], '#l': [lens] });
      return events.filter(verifyEvent);
    },

    /**
     * Recover a holon/lens from the relays into the local Gun store.
     * Re-stores via the normal put path with `_skipSign` so it doesn't loop.
     */
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
     * Move your data between relays. Because every event is signed and
     * content-addressed, "moving" is just copy: read your events from the old
     * relays and republish the SAME events to the new ones — signatures still
     * verify, ids dedup, nothing is re-signed.
     *
     * With no filter, `authors:[you]` fetches ALL your data across every
     * holon/lens in one query — that is how you take everything with you.
     *
     * @param {object} o
     * @param {string[]} o.to - destination relays (required)
     * @param {string[]} [o.from] - source relays (defaults to current)
     * @param {string[]} [o.authors] - pubkeys to move (defaults to you)
     * @param {object} [o.filter] - extra Nostr filter (e.g. {'#h':[holon]})
     * @param {boolean} [o.switch] - if true, setRelays(to) after a successful move
     */
    async migrate({ to, from = relayList, authors = [pubkey], filter = {}, switch: doSwitch = false }) {
      if (!to || !to.length) throw new Error('migrate: `to` relays are required');
      const events = (await pool.querySync(from, { authors, ...filter })).filter(verifyEvent);
      let moved = 0;
      for (const evt of events) {
        const r = await Promise.allSettled(pool.publish(to, evt)); // republish verbatim
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
