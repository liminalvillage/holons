// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Federating hands out no key. A locked lens that flows out to a partner
// reaches it sealed: the partner's members see nothing of it until the
// lens is shared with the partner holon. These two calls let a surface
// say so at the moment of federating, and do it in one tap.

import type { HoloSphere } from 'holosphere';
import { audience, privacyOfHolon, share } from './audience.js';
import type { Audience } from './types.js';

/**
 * The locked lenses this identity owns that flow out to `partner` and the
 * partner cannot open yet — what to offer to share. Pure: give it the
 * audiences a surface already holds.
 */
export function lensesToShare(audiences: Record<string, Audience | undefined>, partner: string, outbound: readonly string[]): string[] {
  const p = String(partner ?? '').trim();
  if (!p) return [];
  return [...new Set(outbound)].filter((lens) => {
    const a = audiences[lens];
    return !!a?.locked && a.owned && !a.holons.some((h) => h.holon === p || h.holon === p.toLowerCase());
  });
}

/** The same, read from the holon's vaults. */
export async function unsharedOutbound(hs: HoloSphere, holonId: string, partner: string, outbound: readonly string[]): Promise<string[]> {
  const holon = String(holonId ?? '').trim();
  if (!holon) return [];
  const locks = await privacyOfHolon(hs, holon);
  const auds: Record<string, Audience> = {};
  for (const lens of new Set(outbound)) {
    if (!locks[lens]?.locked) continue;
    try {
      auds[lens] = await audience(hs, { holon, lens });
    } catch {
      /* not ours to read */
    }
  }
  return lensesToShare(auds, partner, outbound);
}

/** Share each lens with the partner holon: its readers get the keys. Returns the new audiences. */
export async function shareWithPartner(hs: HoloSphere, holonId: string, partner: string, lenses: readonly string[]): Promise<Record<string, Audience>> {
  const out: Record<string, Audience> = {};
  for (const lens of new Set(lenses)) out[lens] = await share(hs, { holon: holonId, lens }, partner);
  return out;
}
