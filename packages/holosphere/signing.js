/**
 * Signing layer for HoloSphere — Phases 1 & 2.
 *
 * Phase 1: sign-on-write + dual-publish to Nostr relay(s), local signed-envelope
 *   storage, relay recover/migrate, and shadow-mode read measurement.
 * Phase 2: a signed `_members` log (genesis + admin-gated add/remove) and
 *   AUTHORIZED READ — reads collapse to the latest claim from a key that was
 *   authorized at the claim's signing time; everything else is `pending`.
 *
 * Opt-in: nothing runs unless `sphere.enableSigning(...)` is called. Loaded
 * dynamically so `nostr-tools` is only needed when enabled. The Gun store still
 * holds raw items at their normal path; signed events live in a reserved
 * `_events` sidecar that ordinary reads never touch. See NOSTR-SIGNING-PLAN.md.
 */

import {
  buildEvent,
  verifyEvent,
  eventToItem,
  getPublicKey,
  HOLOSPHERE_KIND,
} from './nostr-events.js';

const EVENTS_NS = '_events';        // appname/holon/_events/lens/itemId/pubkey -> signed event
const MEMBERSHIP_LENS = '_members'; // signed membership log lens

function freshReport() {
  return {
    reads: 0, items: 0, accounted: 0, wouldDrop: 0,
    unsigned: 0, invalidSig: 0, mismatch: 0, unauthorized: 0,
    byPubkey: {},
  };
}

/**
 * Fold a set of signed membership events into an as-of-time authorization
 * oracle. Genesis is the trust anchor (pinned, or TOFU = earliest self-signed
 * `genesis` event). An add/remove op only takes effect if its author was an
 * admin at that point in the fold. Revocation is as-of-time: a data event signed
 * before a key was removed stays authorized.
 */
function buildTimeline(events, pinnedGenesis) {
  const parsed = events
    .filter(verifyEvent)
    .map((e) => ({ author: e.pubkey, at: e.created_at, id: e.id, ...(eventToItem(e) || {}) }))
    .filter((x) => x.op);

  const byTime = (a, b) => (a.at - b.at) || (a.id < b.id ? -1 : 1);
  const genesisCandidates = parsed
    .filter((x) => x.op === 'genesis' && (!pinnedGenesis || x.author === pinnedGenesis))
    .sort(byTime);
  const genesis = genesisCandidates[0] || null;
  const ops = parsed.filter((x) => x.op === 'add' || x.op === 'remove').sort(byTime);

  function stateAt(t) {
    const roles = new Map();
    if (!genesis || genesis.at > t) return roles;
    roles.set(genesis.author, 'admin');
    for (const op of ops) {
      if (op.at > t) break;
      if (roles.get(op.author) !== 'admin') continue; // only admins mutate membership
      if (op.op === 'add') roles.set(op.pubkey, op.role === 'admin' ? 'admin' : 'member');
      else if (op.op === 'remove') roles.delete(op.pubkey);
    }
    return roles;
  }

  return {
    genesisPub: genesis ? genesis.author : null,
    isAuthorizedAt: (pub, t) => { const r = stateAt(t).get(pub); return r === 'admin' || r === 'member'; },
    roleAt: (pub, t) => stateAt(t).get(pub) || null,
    currentMembers: () => stateAt(Number.MAX_SAFE_INTEGER),
  };
}

export async function createSigner({
  privateKey, relays = [], kind = HOLOSPHERE_KIND, verbose = false,
  shadow = false, enforce = false, storeEnvelope, perActorLenses = [],
}) {
  if (!privateKey) throw new Error('enableSigning: a privateKey is required');
  const { SimplePool } = await import('nostr-tools/pool');

  const pool = new SimplePool();
  let relayList = [...relays];
  const pubkey = getPublicKey(privateKey);
  // enforce modes:
  //   'federation' (default for truthy enforce) — read only keys in your
  //      federation list (holo._allowedAuthors) plus your own key. Reader-scoped,
  //      current-list (Nostr follow model).
  //   'membership' — holon-scoped authority via the signed `_members` log
  //      (genesis + admin add/remove, as-of-time). Opt-in.
  const enforceMode = enforce === 'membership' ? 'membership' : (enforce ? 'federation' : false);
  const envelope = storeEnvelope ?? (shadow || !!enforceMode); // need local envelopes to verify/authorize
  const report = freshReport();
  const pinnedGenesis = new Map();
  const perActor = new Set(perActorLenses); // lenses read as per-author aggregates
  const vlog = (...a) => { if (verbose) console.log('[signing]', ...a); };

  // --- Gun sidecar I/O (reserved _events namespace; reads never see it) -------
  const lensRoot = (holo, holon, lens) => holo.gun.get(holo.appname).get(holon).get(EVENTS_NS).get(lens);
  const itemNode = (holo, holon, lens, itemId) => lensRoot(holo, holon, lens).get(itemId);

  function writeEnvelope(holo, holon, lens, itemId, event) {
    return new Promise((resolve) => {
      let settled = false;
      const done = () => { if (!settled) { settled = true; resolve(); } };
      setTimeout(done, 3000);
      try { itemNode(holo, holon, lens, itemId).get(event.pubkey).put(JSON.stringify(event), () => done()); }
      catch { done(); }
    });
  }
  function mapChildren(node, ms = 2500) {
    return new Promise((resolve) => {
      const out = [];
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(out); } };
      const t = setTimeout(finish, ms);
      node.once((data) => {
        if (!data) { clearTimeout(t); return finish(); }
        const keys = Object.keys(data).filter((k) => k !== '_');
        if (!keys.length) { clearTimeout(t); return finish(); }
        let received = 0;
        node.map().once((val, key) => {
          received++;
          if (val !== undefined && val !== null && key !== '_') out.push([key, val]);
          if (received >= keys.length) { clearTimeout(t); finish(); }
        });
      });
    });
  }
  async function readEnvelopes(holo, holon, lens, itemId) {
    const pairs = await mapChildren(itemNode(holo, holon, lens, itemId));
    const out = [];
    for (const [, val] of pairs) {
      try { out.push(typeof val === 'string' ? JSON.parse(val) : val); } catch { /* skip */ }
    }
    return out;
  }
  async function readLensEnvelopes(holo, holon, lens) {
    const idPairs = await mapChildren(lensRoot(holo, holon, lens));
    const all = [];
    for (const [itemId] of idPairs) all.push(...await readEnvelopes(holo, holon, lens, itemId));
    return all;
  }

  async function resolveMembership(holo, holon) {
    const events = await readLensEnvelopes(holo, holon, MEMBERSHIP_LENS);
    return buildTimeline(events, pinnedGenesis.get(holon));
  }

  // Authorization predicate for the active mode: federation read-list (default)
  // or the holon membership log. `(pubkey, created_at) -> boolean`.
  async function authPredicate(holo, holon) {
    if (enforceMode === 'membership') {
      const tl = await resolveMembership(holo, holon);
      return (pub, at) => tl.isAuthorizedAt(pub, at);
    }
    const readKeys = new Set(holo._allowedAuthors || []);
    readKeys.add(pubkey);
    return (pub) => readKeys.has(pub);
  }

  const signer = {
    pubkey,
    shadow,
    enforce: enforceMode,
    get relays() { return [...relayList]; },
    setRelays(next) { relayList = [...next]; },
    addRelay(url) { if (!relayList.includes(url)) relayList.push(url); },
    getReport() { return { ...report, byPubkey: { ...report.byPubkey } }; },
    resetReport() { Object.assign(report, freshReport()); },
    pinGenesis(holon, pub) { pinnedGenesis.set(holon, pub); },
    resolveMembership,

    /** Build, store (envelope), and optionally relay-publish a signed event. */
    async signAndStore(holo, holon, lens, item, { at, publish = true } = {}) {
      const event = buildEvent({ holon, lens, item, sk: privateKey, kind, created_at: at });
      let ok = 0;
      if (publish && relayList.length) {
        const r = await Promise.allSettled(pool.publish(relayList, event));
        ok = r.filter((x) => x.status === 'fulfilled').length;
      }
      if (holo) await writeEnvelope(holo, holon, lens, item.id, event);
      return { id: event.id, published: ok };
    },

    /**
     * Build the signed event and ISSUE the envelope write synchronously (relay
     * publish stays fire-and-forget). Callers write the raw record immediately
     * after, so reads/subscribers resolve against a consistent envelope the
     * instant the raw write lands — race-free by construction.
     */
    signEnvelope(holo, holon, lens, item) {
      try {
        if (!item || !item.id) return null;
        if (!relayList.length && !envelope) return null;
        const event = buildEvent({ holon, lens, item, sk: privateKey, kind });
        if (envelope && holo) {
          // issued synchronously — lands in Gun's in-memory graph before the raw write
          itemNode(holo, holon, lens, item.id).get(event.pubkey).put(JSON.stringify(event));
        }
        if (relayList.length) Promise.allSettled(pool.publish(relayList, event)).catch(() => {});
        return event;
      } catch (e) { vlog('signEnvelope failed:', e?.message); return null; }
    },

    /** Back-compat alias for the old sign-on-write hook. */
    async onWrite(holo, holon, lens, item) { return signer.signEnvelope(holo, holon, lens, item); },

    /** Signed delete: a signed tombstone, issued before the raw removal. */
    async onDelete(holo, holon, lens, key) {
      if (!key) return null;
      return signer.signEnvelope(holo, holon, lens, { id: String(key), _deleted: true });
    },

    /**
     * Phase 2 AUTHORIZED READ: collapse each item to the latest claim from a key
     * that was authorized at signing time. Returns { items, pending } and updates
     * the report. The membership lens itself is never enforced (would be circular).
     */
    async authorizedView(holo, holon, lens, rawItems) {
      if (lens === MEMBERSHIP_LENS) return { items: rawItems, pending: [] };
      const isAuth = await authPredicate(holo, holon);
      report.reads++;
      const items = [], pending = [];
      // Enumerate from the SIGNED envelope store (so raw-store tampering — a
      // stranger deleting or scribbling a slot — can't change the view), unioned
      // with raw-only ids (unsigned writes) so those still surface as pending.
      const rawById = new Map((rawItems || []).filter((r) => r && r.id != null).map((r) => [String(r.id), r]));
      const ids = new Set((await mapChildren(lensRoot(holo, holon, lens))).map(([k]) => k));
      for (const k of rawById.keys()) ids.add(k);
      for (const id of ids) {
        report.items++;
        const events = await readEnvelopes(holo, holon, lens, id);
        const valid = events.filter(verifyEvent);
        const authorized = valid.filter((e) => isAuth(e.pubkey, e.created_at));
        if (authorized.length) {
          authorized.sort((a, b) => (b.created_at - a.created_at) || (a.id < b.id ? 1 : -1));
          const item = eventToItem(authorized[0]);
          if (item && item._deleted) {
            // authorized SIGNED delete — omit from the view (not pending)
          } else {
            items.push(item);
            report.accounted++;
            report.byPubkey[authorized[0].pubkey] = (report.byPubkey[authorized[0].pubkey] || 0) + 1;
          }
        } else {
          pending.push(rawById.get(id) || { id });
          report.wouldDrop++;
          if (valid.length) report.unauthorized++;
          else if (events.length) report.invalidSig++;
          else report.unsigned++;
        }
      }
      return { items, pending };
    },

    /** Resolve a single item id to its authorized value (or null), honoring deletes. */
    async resolveItem(holo, holon, lens, key) {
      const isAuth = await authPredicate(holo, holon);
      const events = (await readEnvelopes(holo, holon, lens, key))
        .filter(verifyEvent).filter((e) => isAuth(e.pubkey, e.created_at));
      if (!events.length) return null;
      events.sort((a, b) => (b.created_at - a.created_at) || (a.id < b.id ? 1 : -1));
      const item = eventToItem(events[0]);
      return (item && item._deleted) ? null : item;
    },

    /**
     * Per-author aggregate. For each subject (item id) in a lens, return each
     * trusted author's LATEST signed record. The signer IS the owner of their
     * record, so nobody can forge another's (B's write lands under B's key, not
     * A's). Results are filtered by your read-list and carry `_owner` (the
     * signing key) and `_subject` (the item id). This is how collaborative state
     * — participation, reactions, votes, RSVPs — stays signed and filterable
     * without a shared mutable list.
     */
    async aggregate(holo, holon, lens, subject = null) {
      const isAuth = await authPredicate(holo, holon);
      const subjects = subject != null
        ? [String(subject)]
        : (await mapChildren(lensRoot(holo, holon, lens))).map(([k]) => k);
      const out = [];
      for (const subj of subjects) {
        const events = (await readEnvelopes(holo, holon, lens, subj))
          .filter(verifyEvent)
          .filter((e) => isAuth(e.pubkey, e.created_at));
        const latest = new Map(); // pubkey -> that author's latest event
        for (const e of events) {
          const prev = latest.get(e.pubkey);
          if (!prev || e.created_at > prev.created_at || (e.created_at === prev.created_at && e.id > prev.id)) {
            latest.set(e.pubkey, e);
          }
        }
        for (const e of latest.values()) {
          const item = eventToItem(e);
          if (item && !item._deleted) out.push({ ...item, _owner: e.pubkey, _subject: subj }); // signed delete drops the actor
        }
      }
      return out;
    },

    isPerActor: (lens) => perActor.has(lens),
    addPerActorLens: (lens) => perActor.add(lens),
    getPerActorLenses: () => Array.from(perActor),

    /**
     * Shadow verification (Phase 1): classify items against local envelopes
     * (signed vs not), without filtering. Measurement only.
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

    /** Move your data between relays by republishing your signed events verbatim. */
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

export { MEMBERSHIP_LENS };
