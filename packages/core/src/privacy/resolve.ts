// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// "Share with holon X" means one pubkey: a personal holon's id IS its key,
// and a group holon is spoken for by its ANCHOR — the genesis of its signed
// `_members` log, else the earliest `settings` envelope that declares a
// `holonPubkey` and is signed by that very key. The current settings record
// is never consulted: it is last-writer-wins, so whoever wrote it last would
// otherwise choose who receives the holon's keys.

import type { HoloSphere } from 'holosphere';
import { holonAnchor } from 'holosphere/authority.js';
import { isPubkeyHolonId } from './settings.js';

export interface ResolvedGrantee {
  pubkey: string;
  /** How the pubkey was found. */
  via: 'pubkey' | 'anchor';
}

type AnchorHost = HoloSphere & {
  _relaySync?: (holon: string, lens: string, opts?: { await?: boolean }) => Promise<unknown>;
};

/**
 * The pubkey that reads on behalf of `holonOrPubkey`. Throws with a clear
 * message when nothing signed says who speaks for the holon.
 */
export async function resolveGranteePubkey(hs: HoloSphere, holonOrPubkey: string): Promise<ResolvedGrantee> {
  const id = String(holonOrPubkey ?? '').trim();
  if (!id) throw new Error('privacy: a grantee (holon id or pubkey) is required');
  if (isPubkeyHolonId(id)) return { pubkey: id.toLowerCase(), via: 'pubkey' };
  const host = hs as AnchorHost;
  await hs.ready();
  // What says who speaks for the holon travels on the wire.
  for (const lens of ['_members', 'settings']) {
    try { await host._relaySync?.(id, lens, { await: true }); } catch { /* offline: the store decides */ }
  }
  const anchor = holonAnchor(hs.store, id);
  if (anchor) return { pubkey: anchor, via: 'anchor' };
  throw new Error(
    `privacy: nothing signed says who speaks for holon ${id} — share with a personal holon, or with a holon its bot has founded`,
  );
}
