// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Signing layer for HoloSphere.
//
//   sign-on-write   every put/delete becomes a signed NIP-01 event (kind
//                   30078) — the same event the store keeps and the relay
//                   transport publishes; nothing is signed twice.
//   shadow          classify what a lens read would drop under enforce,
//                   without changing output (measurement only).
//   enforce         AUTHORIZED READ — reads collapse to the latest claim from
//                   a key that was authorized at the claim's signing time;
//                   everything else is `pending`. Authority is either the
//                   reader's federation read-list (default) or the holon's
//                   signed `_members` log (genesis + admin-gated add/remove,
//                   as-of-time).
//
// The signer is network-free: envelopes are read from the store's `events`
// table, which the store verified on apply. See SIGNING.md.

import { buildEvent, eventToItem, getPublicKey, HOLOSPHERE_KIND } from './nostr-events.js';
import { isHologram } from './hologram.js';
import { GLOBAL_HOLON } from './store/address.js';

const MEMBERSHIP_LENS = '_members'; // signed membership log lens

const normHolon = (h) => (h === null || h === undefined || h === '' ? null : h);
const wireHolon = (h) => (normHolon(h) === null ? GLOBAL_HOLON : String(h));

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
export function buildTimeline(events, pinnedGenesis) {
  const parsed = events
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

/** Newest first, ties by larger id (the store's LWW tie-break). */
const newestFirst = (a, b) => (b.created_at - a.created_at) || (a.id < b.id ? 1 : -1);

export function createSigner({
  privateKey, kind = HOLOSPHERE_KIND, verbose = false,
  shadow = false, enforce = false, perActorLenses = [],
} = {}) {
  if (!privateKey) throw new Error('createSigner: a privateKey is required');
  const pubkey = getPublicKey(privateKey);
  // enforce modes:
  //   'federation' (default for truthy enforce) — read only keys in your
  //      federation list (holo._allowedAuthors) plus your own key. Reader-scoped,
  //      current-list (Nostr follow model).
  //   'membership' — holon-scoped authority via the signed `_members` log
  //      (genesis + admin add/remove, as-of-time). Opt-in.
  const enforceMode = enforce === 'membership' ? 'membership' : (enforce ? 'federation' : false);
  const report = freshReport();
  const pinnedGenesis = new Map();
  const perActor = new Set(perActorLenses); // lenses read as per-author aggregates
  const vlog = (...a) => { if (verbose) console.log('[signing]', ...a); };

  // --- envelope reads (the store's events table) -----------------------------
  const envelopes = (holo, holon, lens, id) => holo.store.getEvents(normHolon(holon), lens, String(id));
  const lensIds = (holo, holon, lens) => holo.store.listEventIds(normHolon(holon), lens);

  async function resolveMembership(holo, holon) {
    const events = [];
    for (const id of lensIds(holo, holon, MEMBERSHIP_LENS)) events.push(...envelopes(holo, holon, MEMBERSHIP_LENS, id));
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

  /** Tombstone handling for an authorized claim. Pointer claims are returned
   *  as pointers: the INSTANCE resolves them (get/subscribe thread the cycle
   *  guard through the resolver; getAll already resolved them). */
  function materialize(item, { includeDeleted = false } = {}) {
    if (!item) return null;
    if (item._deleted && !includeDeleted) return null;
    return item;
  }

  function build(holo, holon, lens, item, at) {
    const h = normHolon(holon);
    return buildEvent({
      holon: wireHolon(holon), lens, item, sk: privateKey, kind,
      created_at: at ?? holo.store.nextCreatedAt(h, lens, String(item.id)),
      // `n` scopes events to one app namespace on a shared relay.
      extraTags: [['n', holo.appname]],
    });
  }

  const signer = {
    pubkey,
    shadow,
    enforce: enforceMode,
    verbose,
    /** Relays are owned by the transport now; kept for API compatibility. */
    get relays() { return []; },
    setRelays() {},
    addRelay() {},
    getReport() { return { ...report, byPubkey: { ...report.byPubkey } }; },
    resetReport() { Object.assign(report, freshReport()); },
    pinGenesis(holon, pub) { pinnedGenesis.set(holon, pub); },
    resolveMembership,

    /** Build the signed event for a write. The caller applies and publishes it. */
    signEnvelope(holo, holon, lens, item) {
      if (!item || item.id === undefined || item.id === null) return null;
      return build(holo, holon, lens, item);
    },

    /** Build, apply to the store and publish a signed event (membership ops). */
    async signAndStore(holo, holon, lens, item, { at, publish = true } = {}) {
      const event = build(holo, holon, lens, item, at);
      holo.store.apply(event, { origin: 'local' });
      let published = 0;
      if (publish && holo._relayTransport) {
        try {
          holo._relayTransport.publishWrite(normHolon(holon), lens, item, { key: String(item.id), signedEvent: event, skipProjections: true });
          published = holo._relayTransport.relays.length;
        } catch (e) { vlog('publish failed:', e?.message); }
      }
      return { id: event.id, published };
    },

    /** Back-compat alias for the old sign-on-write hook. */
    async onWrite(holo, holon, lens, item) { return signer.signEnvelope(holo, holon, lens, item); },

    /** Signed delete: a signed tombstone event (the caller applies + publishes it). */
    async onDelete(holo, holon, lens, key) {
      if (!key) return null;
      return signer.signEnvelope(holo, holon, lens, { id: String(key), _deleted: true });
    },

    /**
     * AUTHORIZED READ: collapse each item to the latest claim from a key that
     * was authorized at signing time. Returns { items, pending } and updates the
     * report. The membership lens itself is never enforced (would be circular).
     * `rawItems` are what the plain read produced (pointers already resolved);
     * an authorized claim that is a pointer takes that resolved value.
     */
    async authorizedView(holo, holon, lens, rawItems, opts = {}) {
      if (lens === MEMBERSHIP_LENS) return { items: rawItems, pending: [] };
      const isAuth = await authPredicate(holo, holon);
      report.reads++;
      const items = [], pending = [];
      // Enumerate from the SIGNED claims (so raw-store tampering can't change
      // the view), unioned with raw-only ids (unsigned writes) so those still
      // surface as pending.
      const rawById = new Map((rawItems || []).filter((r) => r && r.id != null).map((r) => [String(r.id), r]));
      const ids = new Set(lensIds(holo, holon, lens));
      for (const k of rawById.keys()) ids.add(k);
      for (const id of ids) {
        const events = envelopes(holo, holon, lens, id);
        report.items++;
        const authorized = events.filter((e) => isAuth(e.pubkey, e.created_at)).sort(newestFirst);
        if (authorized.length) {
          const claim = eventToItem(authorized[0]);
          if (claim && claim._deleted && !opts.includeDeleted) {
            // authorized SIGNED delete — omit from the view (not pending)
            continue;
          }
          let item = claim;
          if (isHologram(claim) && !claim._deleted) {
            // A pointer claim: take the plain read's resolution of it when it
            // has one, otherwise resolve it now.
            item = rawById.get(id);
            if (!item) {
              try {
                const res = await holo.resolveHologramDetailed(claim, { followHolograms: true });
                item = res.status === 'resolved' ? res.data : null;
              } catch { item = null; }
            }
          }
          if (!item) continue; // an unresolved pointer is neither shown nor pending
          items.push(item);
          report.accounted++;
          report.byPubkey[authorized[0].pubkey] = (report.byPubkey[authorized[0].pubkey] || 0) + 1;
        } else {
          pending.push(rawById.get(id) || { id });
          report.wouldDrop++;
          if (events.length) report.unauthorized++;
          else report.unsigned++;
        }
      }
      return { items, pending };
    },

    /** Resolve a single item id to its authorized value (or null), honoring deletes. */
    async resolveItem(holo, holon, lens, key, opts = {}) {
      const isAuth = await authPredicate(holo, holon);
      const events = envelopes(holo, holon, lens, key)
        .filter((e) => isAuth(e.pubkey, e.created_at))
        .sort(newestFirst);
      if (!events.length) return null;
      return materialize(eventToItem(events[0]), opts);
    },

    /**
     * Per-author aggregate. For each subject (item id) in a lens, return each
     * trusted author's LATEST signed record. The signer IS the owner of their
     * record, so nobody can forge another's. Results are filtered by your
     * read-list and carry `_owner` (the signing key) and `_subject` (the item
     * id). This is how collaborative state — participation, reactions, votes,
     * RSVPs — stays signed and filterable without a shared mutable list.
     */
    async aggregate(holo, holon, lens, subject = null) {
      const isAuth = await authPredicate(holo, holon);
      const subjects = subject != null ? [String(subject)] : lensIds(holo, holon, lens);
      const out = [];
      for (const subj of subjects) {
        // The store keeps each author's latest claim per address already.
        const events = envelopes(holo, holon, lens, subj).filter((e) => isAuth(e.pubkey, e.created_at));
        for (const e of events) {
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
     * Shadow verification: classify items against their signed claims (signed
     * vs not), without filtering. Measurement only.
     */
    async shadowCheck(holo, holon, lens, items) {
      const call = { items: 0, accounted: 0, wouldDrop: 0, unsigned: 0, invalidSig: 0, mismatch: 0 };
      if (!Array.isArray(items) || !items.length) return call;
      report.reads++;
      for (const item of items) {
        if (!item || !item.id) continue;
        call.items++; report.items++;
        const events = envelopes(holo, holon, lens, item.id);
        if (events.some((e) => String(eventToItem(e)?.id) === String(item.id))) {
          call.accounted++; report.accounted++;
          for (const e of events) report.byPubkey[e.pubkey] = (report.byPubkey[e.pubkey] || 0) + 1;
        } else if (events.length) {
          call.mismatch++; report.mismatch++; call.wouldDrop++; report.wouldDrop++;
        } else {
          call.unsigned++; report.unsigned++; call.wouldDrop++; report.wouldDrop++;
        }
      }
      if (call.wouldDrop > 0) {
        console.log(`[signing:shadow] ${holon}/${lens}: ${call.items} items, ${call.accounted} accounted, ${call.wouldDrop} would-drop (unsigned ${call.unsigned}, mismatch ${call.mismatch}, invalid-sig ${call.invalidSig})`);
      }
      return call;
    },

    /** No relays here — the transport publishes. Kept for API compatibility. */
    publishEvents() {},
    subscribeRaw() { return () => {}; },
    ensureReverse() {},
    get reverse() { return null; },
    close() {},
  };

  return signer;
}

export { MEMBERSHIP_LENS };
