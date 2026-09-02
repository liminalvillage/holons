// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Store addressing. A record lives at (holon, lens, id); globals (holon-less
// records) use the `_g` sentinel — the same value the relay transport puts in
// the `h` tag, so the store and the wire agree on what a global is.
//
// A soul (`app/holon/lens/id`, see hologram.js) is the public, cross-instance
// name of a record; an addr is the store's internal key for it.

import { parseSoulPath } from '../hologram.js';

/** Sentinel holon for globals, on the wire and in the store. */
export const GLOBAL_HOLON = '_g';

/** Reserved holon namespace used by the capability registry shim. */
export const CAPABILITIES_HOLON = '_capabilities';

// Unit separator: cannot appear in a Telegram chat id, an H3 cell or a lens
// name, and never survives JSON-as-a-key round trips by accident.
const SEP = '';

function segment(value, what) {
    if (value === null || value === undefined) throw new Error(`store: ${what} is required`);
    const s = String(value);
    if (!s) throw new Error(`store: ${what} must not be empty`);
    if (s.includes(SEP)) throw new Error(`store: ${what} contains a reserved character`);
    return s;
}

/** The holon key a (possibly null) holon maps to. */
export function holonKey(holon) {
    return holon === null || holon === undefined || holon === '' ? GLOBAL_HOLON : segment(holon, 'holon');
}

/** The holon a holon key maps back to (`_g` → null). */
export function holonFromKey(key) {
    return key === GLOBAL_HOLON ? null : key;
}

/** Key of a whole lens: `holon|lens`. */
export function lensKey(holon, lens) {
    return `${holonKey(holon)}${SEP}${segment(lens, 'lens')}`;
}

/** Key of one record: `holon|lens|id`. */
export function addr(holon, lens, id) {
    return `${lensKey(holon, lens)}${SEP}${segment(id, 'id')}`;
}

/** Split a lens key back into `{ holon, lens }` (holon null for globals). */
export function parseLensKey(key) {
    const [h, lens] = String(key).split(SEP);
    return { holon: holonFromKey(h), lens };
}

/** Split an addr back into `{ holon, lens, id }` (holon null for globals). */
export function parseAddr(a) {
    const parts = String(a).split(SEP);
    if (parts.length !== 3) return null;
    return { holon: holonFromKey(parts[0]), lens: parts[1], id: parts[2] };
}

/** The lens key an addr belongs to. */
export function lensKeyOfAddr(a) {
    const i = String(a).lastIndexOf(SEP);
    return i < 0 ? a : a.slice(0, i);
}

/** Public soul of a record: `app/holon/lens/id`. */
export function soulOf(appName, holon, lens, id) {
    return `${appName}/${holonKey(holon)}/${segment(lens, 'lens')}/${segment(id, 'id')}`;
}

/**
 * The addr a soul names, or null when the soul is malformed or belongs to
 * another app (when `appName` is given).
 */
export function addrFromSoul(soul, appName) {
    const info = parseSoulPath(soul);
    if (!info) return null;
    if (appName !== undefined && info.appname !== appName) return null;
    try {
        return addr(info.holon, info.lens, info.key);
    } catch {
        return null;
    }
}
