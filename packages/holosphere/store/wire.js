// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The wire registry: which event kinds this store consumes, and how each one
// decodes into a record address.
//
// One lens owns one wire. The legacy wire is kind 30078 carrying the h/l/d/n
// tag envelope, and it stays the default for every lens without a standard
// equivalent — 30078 is NIP-78 application-specific data, not a private
// invention. A standard-primary lens brings its own kind and its own grammar
// (a codec's `wire`), so NIP-52 calendar events and our own envelopes can sit
// at the same addresses in one store.
//
// `decode` returns an ARRAY because one event may claim several addresses at
// once: a NIP-09 kind 5 retracts every coordinate named in its `a` tags.

import { HOLOSPHERE_KIND, HOLOSPHERE_LOG_KIND, eventToItem, logRefs, tag } from '../nostr-events.js';
import { GLOBAL_HOLON } from './address.js';
import { isSealed, lockedStub } from './sealed.js';

/** NIP-09 retraction. */
const DELETE_KIND = 5;

/**
 * The wire of an APPEND-ONLY lens: a regular kind (1808) whose every event is
 * its own record, addressed by the event id. Nothing at such an address is
 * ever superseded — `claimKey` and `wins()` in the store only ever see one
 * claim there — so the whole log is retained without touching the ordering
 * rule the replaceable lenses live by. The decode is lens-agnostic (it reads
 * the `l` tag) because the registry keeps ONE decoder per kind; the registry
 * then keeps only the claims whose lens was registered as append-only.
 *
 * The body comes back with `id` = event id and a `_log` block (author, time,
 * refs) so a record read straight from the store is self-describing.
 */
export function createAppendWire({ lens, appName, kind = HOLOSPHERE_LOG_KIND } = {}) {
    if (!lens) throw new Error('createAppendWire: lens is required');
    return {
        lens: String(lens),
        kinds: [kind],
        append: true,
        filters: (holon) => [{
            kinds: [kind], '#h': [String(holon)], '#l': [String(lens)],
            ...(appName ? { '#n': [String(appName)] } : {}),
        }],
        decode(event) {
            if (!event || event.kind !== kind || typeof event.content !== 'string') return null;
            const h = tag(event, 'h');
            const l = tag(event, 'l');
            if (!h || !l) return null;
            const body = eventToItem(event);
            if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
            return [{
                holon: h === GLOBAL_HOLON ? null : h,
                lens: l,
                id: event.id,
                item: {
                    ...body,
                    id: event.id,
                    _log: { pubkey: event.pubkey, created_at: event.created_at, kind, refs: logRefs(event) },
                },
            }];
        },
    };
}

/**
 * Decode a kind-30078 event into its address + item, or null when malformed.
 *
 * The `h` and `l` tags carry the address; the id comes from the payload, and
 * falls back to the d-tag remainder (`holon/lens/id`) when the payload has none.
 *
 * SEALED content (see sealed.js) is recognised BEFORE the plain path — its
 * payload has no `id`, so the plain path would otherwise address it by the
 * d-tag and keep the ciphertext as if it were an item. With an `unseal`
 * function the item is opened (and must carry the address's own id, or the
 * event is not a claim); without one, or when no key opens it, the claim
 * becomes a LOCKED STUB so it still supersedes older plaintext at the address.
 */
export function decodeEvent(event, unseal = null) {
    if (!event || typeof event !== 'object' || typeof event.content !== 'string') return null;
    const h = tag(event, 'h');
    const lens = tag(event, 'l');
    if (!h || !lens) return null;
    const payload = eventToItem(event);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    const holon = h === GLOBAL_HOLON ? null : h;
    if (isSealed(payload)) {
        const d = tag(event, 'd') || '';
        const id = d.split('/').slice(2).join('/');
        if (!id) return null;
        let item = null;
        if (typeof unseal === 'function') {
            try { item = unseal({ holon, lens, id, sealed: payload, event }); } catch { item = null; }
        }
        if (item) {
            if (typeof item !== 'object' || Array.isArray(item)) return null;
            if (String(item.id ?? '') !== id) return null;   // a payload sealed for another address
            return { holon, lens, id, item, sealed: payload };
        }
        return { holon, lens, id, item: lockedStub(id, payload), sealed: payload };
    }
    const item = payload;
    let id = item.id !== undefined && item.id !== null ? String(item.id) : '';
    if (!id) {
        const d = tag(event, 'd') || '';
        id = d.split('/').slice(2).join('/');
    }
    if (!id) return null;
    return { holon, lens, id, item };
}

/**
 * @typedef {object} LensWire
 * @property {string}   lens
 * @property {number[]} kinds   kinds this lens claims as its canonical wire
 * @property {(event: object) => Array<{holon: string|null, lens: string, id: string, item: object}>|null} decode
 */

/**
 * A mutable map of kind → decoder, seeded with the legacy 30078 wire.
 *
 * Mutable on purpose: `enableSigning` can register projections long after the
 * store was constructed, so the registry has to accept a wire at any time.
 */
export function createWireRegistry({ legacyKind = HOLOSPHERE_KIND, unseal = null } = {}) {
    const byKind = new Map();        // kind → LensWire
    const byLens = new Map();        // lens → LensWire[]
    const standardLenses = new Set();
    const appendLenses = new Set();  // lenses carried on the append-only log kind
    let unsealer = typeof unseal === 'function' ? unseal : null;

    /**
     * A NIP-09 retraction, as one soft tombstone per address it names.
     *
     * Deliberately NOT a new concept downstream: `isTombstone`, the list
     * filters, the watchers and enforce mode all already understand a record
     * whose item carries `_deleted`, so a kind 5 becomes one of those and
     * nothing else has to learn about deletion twice.
     *
     * Authorization is the NIP-09 rule itself and nothing more: an author may
     * retract only their own events, which the `a` coordinate carries, so an
     * event naming somebody else's address is simply not a claim.
     */
    function decodeRetraction(event) {
        const out = [];
        for (const t of event.tags || []) {
            if (t[0] !== 'a' || typeof t[1] !== 'string') continue;
            const parts = t[1].split(':');
            if (parts.length < 3) continue;
            const targetKind = Number(parts[0]);
            const targetPubkey = String(parts[1]).toLowerCase();
            const dTag = parts.slice(2).join(':');
            if (targetPubkey !== String(event.pubkey).toLowerCase()) continue;
            const w = byKind.get(targetKind);
            if (!w || typeof w.address !== 'function') continue;
            let a = null;
            try { a = w.address(dTag); } catch { continue; }
            if (!a || !a.id) continue;
            out.push({ holon: a.holon, lens: a.lens, id: a.id, item: { id: a.id, _deleted: true } });
        }
        return out.length ? out : null;
    }

    return {
        legacyKind,

        /**
         * Install (or clear) the function that opens sealed envelopes:
         * `({ holon, lens, id, sealed, event }) => item | null`. Installed by
         * the privacy layer once it holds keys; the store's `rescan` then
         * re-decodes what was locked.
         */
        setUnseal(fn) {
            unsealer = typeof fn === 'function' ? fn : null;
        },

        /** Claim `wire.kinds` for `wire.lens`. Re-registering a kind replaces it. */
        register(wire) {
            if (!wire || !wire.lens || typeof wire.decode !== 'function') return;
            for (const k of wire.kinds || []) {
                if (k === legacyKind) continue;   // the envelope is never overridable
                byKind.set(k, wire);
            }
            const lens = String(wire.lens);
            if (!byLens.has(lens)) byLens.set(lens, []);
            byLens.get(lens).push(wire);
            standardLenses.add(lens);
            if (wire.append === true) appendLenses.add(lens);
        },

        /** The wires registered for a lens, in registration order. */
        wiresFor(lens) {
            return byLens.get(String(lens)) || [];
        },

        /** Is this lens an append-only log (every event its own record)? */
        isAppend(lens) {
            return appendLenses.has(String(lens));
        },

        /**
         * Can this lens be WRITTEN on its own wire?
         *
         * A standard-primary lens without an encoder is read-only: its records
         * are authored elsewhere, by whoever owns that kind.
         */
        canEncode(lens) {
            return (byLens.get(String(lens)) || []).some((w) => typeof w.encode === 'function');
        },

        /** Is this lens canonically encoded as a standard kind? */
        isStandardPrimary(lens) {
            return standardLenses.has(String(lens));
        },

        /** Every kind this store consumes, legacy first. */
        kinds() {
            return [legacyKind, ...byKind.keys()];
        },

        accepts(kind) {
            // Kind 5 is consumable only once some lens is carried on a standard
            // kind: on the envelope alone a delete is a tombstone record, and
            // there is nothing for a retraction to name.
            return kind === legacyKind || byKind.has(kind) || (kind === DELETE_KIND && byKind.size > 0);
        },

        /**
         * Address claims made by an event, or null when it is not ours or
         * unparsable. Never throws: a codec's grammar is untrusted input.
         */
        decode(event) {
            if (!event || typeof event !== 'object') return null;
            if (event.kind === legacyKind) {
                const d = decodeEvent(event, unsealer);
                // A replaceable envelope has no business at a log address: a
                // forged tombstone `{ id: <eventId>, _deleted: true }` would
                // otherwise win last-writer-wins in `records` and shadow the
                // entry. Not a claim.
                if (d && appendLenses.has(String(d.lens))) return null;
                return d ? [d] : null;
            }
            if (event.kind === DELETE_KIND) return byKind.size ? decodeRetraction(event) : null;
            const w = byKind.get(event.kind);
            if (!w) return null;
            let claims = null;
            try {
                claims = w.decode(event);
            } catch {
                return null;                       // a malformed foreign event, not a crash
            }
            if (!claims) return null;
            let out = Array.isArray(claims) ? claims : [claims];
            // One decoder serves every append lens; a log event naming a lens
            // nobody registered as append-only is not ours.
            if (w.append === true) out = out.filter((c) => c && appendLenses.has(String(c.lens)));
            return out.length ? out : null;
        },
    };
}
