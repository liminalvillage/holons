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

import { HOLOSPHERE_KIND, eventToItem, tag } from '../nostr-events.js';
import { GLOBAL_HOLON } from './address.js';

/**
 * Decode a kind-30078 event into its address + item, or null when malformed.
 *
 * The `h` and `l` tags carry the address; the id comes from the payload, and
 * falls back to the d-tag remainder (`holon/lens/id`) when the payload has none.
 */
export function decodeEvent(event) {
    if (!event || typeof event !== 'object' || typeof event.content !== 'string') return null;
    const h = tag(event, 'h');
    const lens = tag(event, 'l');
    if (!h || !lens) return null;
    const item = eventToItem(event);
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    let id = item.id !== undefined && item.id !== null ? String(item.id) : '';
    if (!id) {
        const d = tag(event, 'd') || '';
        id = d.split('/').slice(2).join('/');
    }
    if (!id) return null;
    return { holon: h === GLOBAL_HOLON ? null : h, lens, id, item };
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
export function createWireRegistry({ legacyKind = HOLOSPHERE_KIND } = {}) {
    const byKind = new Map();        // kind → LensWire
    const byLens = new Map();        // lens → LensWire[]
    const standardLenses = new Set();

    return {
        legacyKind,

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
        },

        /** The wires registered for a lens, in registration order. */
        wiresFor(lens) {
            return byLens.get(String(lens)) || [];
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
            return kind === legacyKind || byKind.has(kind);
        },

        /**
         * Address claims made by an event, or null when it is not ours or
         * unparsable. Never throws: a codec's grammar is untrusted input.
         */
        decode(event) {
            if (!event || typeof event !== 'object') return null;
            if (event.kind === legacyKind) {
                const d = decodeEvent(event);
                return d ? [d] : null;
            }
            const w = byKind.get(event.kind);
            if (!w) return null;
            let claims = null;
            try {
                claims = w.decode(event);
            } catch {
                return null;                       // a malformed foreign event, not a crash
            }
            if (!claims) return null;
            const out = Array.isArray(claims) ? claims : [claims];
            return out.length ? out : null;
        },
    };
}
