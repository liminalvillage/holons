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
import { resolveBackend, resolveRelays, resolveSigningMode } from "./config";
import type { HoloSphere } from "holosphere";

/** Pubkey (hex) of the adopted session identity, or null when none. */
export const sessionKeyPub = writable<string | null>(null);

// The adopted secret itself, retained ONLY in module memory for signatures
// HoloSphere doesn't make on our behalf (e.g. shift RSVPs, which are Nostr
// events on a foreign relay, not lens writes). Same lifetime and posture as
// the ambient identity: never persisted, dropped on logout/reload.
let sessionSecret: string | null = null;

/** The in-memory session secret (hex), or null when none is adopted. */
export function getSessionSecret(): string | null {
  return sessionSecret;
}

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
 * Which relays this session's signer publishes to.
 *
 * `login` replaces whatever signer was in place, so it has to re-state the
 * publishing arrangement or adopting a key would silently stop relay writes:
 *  - nostr backend → `[]`. The relay transport is the single publisher and
 *    signs each write with the adopted identity already; a second publisher
 *    here would duplicate every event.
 *  - gun backend + a signing mode → the configured relays, so writes keep
 *    reaching the relay as signed events, now under the user's own key.
 *  - gun backend, signing off → `[]`, envelope-only, as before.
 */
function signingRelays(): string[] {
  if (resolveBackend() === "nostr") return [];
  return resolveSigningMode() === "off" ? [] : resolveRelays();
}

/**
 * Adopt a paired secret key as this session's signing identity. Returns the
 * pubkey, or null when the key is unusable.
 */
export async function adoptSessionKey(
  secretHex: string,
): Promise<string | null> {
  try {
    const hs = (await getHolosphere()) as HoloSphere & SigningIdentity;
    const { pubkey } = await hs.login(secretHex, { relays: signingRelays() });
    sessionSecret = secretHex;
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
  sessionSecret = null;
  sessionKeyPub.set(null);
}
