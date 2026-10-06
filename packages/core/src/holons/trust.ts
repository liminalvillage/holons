// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Whose standard-kind edits a holon folds back: its seated keys and its
// anchor. The bot derives this from its trust cache; a key host (kiosk, MCP,
// web) reads it from the signed `_members` log, so a member's kind-0 edit on
// any Nostr client reaches their `users` record here too.

import type { HoloSphere } from 'holosphere';
import { resolveHolonAuthority } from '../holosphere/authority.js';
import { holonMembers } from '../protocol/founding.js';

/** A `trustedAuthors(holon)` hook for `createHoloSphere({ nostr })`: the holon's seated keys plus its anchor. */
export function membersTrustedAuthors(hs: HoloSphere): (holon: string) => Promise<string[]> {
  return async (holon: string) => {
    const out = new Set<string>();
    try {
      for (const pk of (await holonMembers(hs, holon)).keys()) out.add(String(pk).toLowerCase());
    } catch {
      /* no log: nobody beyond the anchor */
    }
    try {
      const anchor = resolveHolonAuthority(hs, holon).anchor;
      if (anchor) out.add(anchor.toLowerCase());
    } catch {
      /* no authority */
    }
    return [...out];
  };
}
