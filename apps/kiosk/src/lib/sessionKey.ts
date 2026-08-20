// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// The user's own signing identity for this kiosk session.
//
// The key arrives via the E2E pairing flow (see pairing.ts): generated
// client-side in our Telegram Mini App, held in the user's Telegram
// CloudStorage, and sealed to this kiosk's ephemeral key for the hop. It is
// adopted AMBIENTLY on the live HoloSphere instance (`hs.login`) so every
// subsequent write is signed as the user — and it lives in memory only.
// A kiosk is a shared device: the key is never persisted here, and logging
// out (or reloading) drops it, reverting writes to the device key identity.

import { writable } from "svelte/store";
import { getHolosphere } from "./holosphere";
import type { HoloSphere } from "holosphere";

/** Pubkey (hex) of the adopted session identity, or null when none. */
export const sessionKeyPub = writable<string | null>(null);

/** Whether the key-link pairing modal is open. */
export const keyLinkOpen = writable<boolean>(false);

// The ambient-identity API exists on the instance but isn't in
// holosphere.d.ts yet; keep the cast in one place.
type SigningIdentity = {
  login(
    privateKey: string,
    opts?: { relays?: string[] },
  ): Promise<{ pubkey: string }>;
  logout(): void;
};

/**
 * Adopt a paired secret key as this session's signing identity. Returns the
 * pubkey, or null when the key is unusable. `relays: []` keeps the signer
 * envelope-only — on the nostr backend the relay transport must stay the
 * single publisher, and on the gun backend there is nothing to publish to.
 */
export async function adoptSessionKey(
  secretHex: string,
): Promise<string | null> {
  try {
    const hs = (await getHolosphere()) as HoloSphere & SigningIdentity;
    const { pubkey } = await hs.login(secretHex, { relays: [] });
    sessionKeyPub.set(pubkey);
    return pubkey;
  } catch (err) {
    console.error("[kiosk] could not adopt session key", err);
    return null;
  }
}

/** Drop the session identity (logout / unlink); writes fall back to anonymous. */
export async function dropSessionKey(): Promise<void> {
  try {
    ((await getHolosphere()) as HoloSphere & SigningIdentity).logout();
  } catch {
    /* instance never came up — nothing to drop */
  }
  sessionKeyPub.set(null);
}
