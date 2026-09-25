// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// The privacy operations every surface calls. The holosphere instance holds
// the vaults and keys (its `privacy` layer); this module adds the rules a UI
// must not re-implement: which lenses may be private, who a "holon" resolves
// to, and the public hint kept in step with the vault.

import type { HoloSphere } from 'holosphere';
import { readHolonSettings, saveSettings } from '../settings/persistence.js';
import { resolveGranteePubkey } from './resolve.js';
import { assertPrivatizable, readPrivacy, withLensPrivacy } from './settings.js';
import type { GranteeView, PrivacyLensMode, PrivacySnapshot } from './types.js';

type PrivacyHost = HoloSphere & {
  isAppendLens?: (lens: string) => boolean;
  store?: { wire?: { isStandardPrimary?: (lens: string) => boolean } };
};

function privacyOf(hs: HoloSphere): HoloSphere['privacy'] {
  const p = (hs as PrivacyHost).privacy;
  if (!p) throw new Error('privacy: this holosphere instance has no privacy layer');
  return p;
}

function ctxOf(hs: HoloSphere) {
  const h = hs as PrivacyHost;
  return {
    isAppend: (lens: string) => !!h.isAppendLens?.(lens),
    isStandardPrimary: (lens: string) => !!h.store?.wire?.isStandardPrimary?.(lens),
  };
}

/**
 * Make a lens private or public. The owner's vault is the source of truth
 * (the key is created on first use); the settings record gets the public
 * hint so other surfaces can show a lock.
 */
export async function setLensPrivacy(hs: HoloSphere, holonId: string, lens: string, mode: PrivacyLensMode): Promise<{ lens: string; mode: PrivacyLensMode }> {
  const holon = String(holonId ?? '').trim();
  if (!holon) throw new Error('privacy: a holon id is required');
  assertPrivatizable(lens, ctxOf(hs));
  await privacyOf(hs).setLensMode(holon, lens, mode);
  try {
    const current = (await readHolonSettings(hs, holon)) ?? { id: holon };
    const next = withLensPrivacy({ ...current, id: current.id ?? holon }, lens, mode);
    await saveSettings(hs, holon, next);
  } catch (err) {
    console.warn('[privacy] settings hint not updated:', (err as Error)?.message);
  }
  return { lens, mode };
}

/** The privacy state of a holon as this identity sees it. */
export async function getPrivacySnapshot(hs: HoloSphere, holonId: string): Promise<PrivacySnapshot> {
  const holon = String(holonId ?? '').trim();
  const p = privacyOf(hs);
  const lenses: Record<string, PrivacyLensMode> = {};
  const settings = await readHolonSettings(hs, holon).catch(() => null);
  for (const [lens, mode] of Object.entries(readPrivacy(settings).lenses)) lenses[lens] = mode;
  // Owned vaults win over the hint — and make sure they are loaded.
  for (const lens of Object.keys(lenses)) await p.ensureKeys(holon, lens);
  const owned = p.ownedLenses(holon);
  for (const [lens, mode] of Object.entries(owned)) lenses[lens] = mode === 'public' ? 'public' : 'private';
  const grants = (Object.keys(owned).length ? await p.listGrants(holon) : {}) as Record<string, GranteeView>;
  return { lenses, owned: Object.keys(owned).filter((l) => owned[l] !== 'public'), grants };
}

/** Share a whole lens with a holon (its pubkey) or a pubkey. */
export async function grantLens(hs: HoloSphere, holonId: string, lens: string, grantee: string) {
  const { pubkey } = await resolveGranteePubkey(hs, grantee);
  return privacyOf(hs).grantLens(String(holonId), lens, pubkey);
}

/** Share one item with a holon (its pubkey) or a pubkey. */
export async function grantItem(hs: HoloSphere, holonId: string, lens: string, itemId: string, grantee: string) {
  const { pubkey } = await resolveGranteePubkey(hs, grantee);
  return privacyOf(hs).grantItem(String(holonId), lens, String(itemId), pubkey);
}

/** Take a lens back: every key rotates, the lens is rewritten, the rest are re-granted. Forward-only. */
export async function revokeLens(hs: HoloSphere, holonId: string, lens: string, grantee: string) {
  const { pubkey } = await resolveGranteePubkey(hs, grantee);
  return privacyOf(hs).revokeLens(String(holonId), lens, pubkey);
}

/** Take one item back: its content key rotates and it is rewritten. Forward-only. */
export async function revokeItem(hs: HoloSphere, holonId: string, lens: string, itemId: string, grantee: string) {
  const { pubkey } = await resolveGranteePubkey(hs, grantee);
  return privacyOf(hs).revokeItem(String(holonId), lens, String(itemId), pubkey);
}

/** The grant ledger of a lens (or of every private lens this identity owns in the holon). */
export async function listGrants(hs: HoloSphere, holonId: string, lens?: string): Promise<Record<string, GranteeView>> {
  return privacyOf(hs).listGrants(String(holonId), lens) as Promise<Record<string, GranteeView>>;
}

/**
 * Accept a grant that arrived out of band (a pasted payload, a bot relaying
 * one). Grants over the relay are accepted automatically by the instance.
 * The sender must speak for the holon (its key, its anchor or a member);
 * `trusted: true` is the user's explicit choice to take the key anyway.
 */
export async function acceptGrant(hs: HoloSphere, payload: unknown, sender: string | null = null, opts: { trusted?: boolean } = {}) {
  return privacyOf(hs).acceptGrant(payload as never, sender, opts);
}
