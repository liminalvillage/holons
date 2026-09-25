// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// The grant codec: what rides inside a `holons/grant` DM. Strict on the way
// in — a grant installs a key, so a malformed one is dropped, never guessed.

import { GRANT_TYPE, GRANT_VERSION, type GrantPayload } from './types.js';

const HEX64 = /^[0-9a-f]{64}$/i;
const KID = /^[0-9a-f]{16}$/;

/** Serialise a grant for the DM body. */
export function encodeGrant(payload: GrantPayload): string {
  return JSON.stringify(payload);
}

/** Parse a grant body; null when it is not a well-formed grant. */
export function parseGrant(raw: unknown): GrantPayload | null {
  let p: unknown = raw;
  if (typeof raw === 'string') {
    try { p = JSON.parse(raw); } catch { return null; }
  }
  if (!p || typeof p !== 'object') return null;
  const o = p as Record<string, unknown>;
  if (o.t !== GRANT_TYPE || o.v !== GRANT_VERSION) return null;
  if (typeof o.holon !== 'string' || !o.holon || typeof o.lens !== 'string' || !o.lens) return null;
  if (typeof o.kid !== 'string' || !KID.test(o.kid)) return null;
  const out: GrantPayload = {
    t: GRANT_TYPE,
    v: GRANT_VERSION,
    id: typeof o.id === 'string' ? o.id : '',
    holon: o.holon,
    lens: o.lens,
    kid: o.kid,
    at: typeof o.at === 'string' ? o.at : new Date().toISOString(),
  };
  if (o.item != null) {
    if (typeof o.item !== 'string' || !o.item || typeof o.cek !== 'string' || !HEX64.test(o.cek)) return null;
    out.item = o.item;
    out.cek = o.cek.toLowerCase();
  } else {
    if (typeof o.key !== 'string' || !HEX64.test(o.key)) return null;
    out.key = o.key.toLowerCase();
  }
  return out;
}

/** Is this a lens grant (as opposed to a single item)? */
export function isLensGrant(g: GrantPayload): boolean {
  return typeof g.key === 'string' && g.item == null;
}
