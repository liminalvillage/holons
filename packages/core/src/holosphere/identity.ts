/**
 * Identity helpers shared by all UIs.
 *
 * These functions encapsulate the "can I write here as <actingAs>?" check so
 * web and telegram-ui both ask the same question the same way. The web app
 * pulls `actingAs` from a Svelte store; the bot pulls it from its key
 * manager — but the check itself lives here.
 */

import type { HoloSphere } from 'holosphere';

/** Resolver for the current acting holon identity. May be sync or async. */
export type ActingAsResolver = string | null | (() => string | null | Promise<string | null>);

/** Resolve an `ActingAsResolver` to its underlying value. */
export async function resolveActingAs(resolver: ActingAsResolver): Promise<string | null> {
  if (typeof resolver === 'function') {
    return await resolver();
  }
  return resolver;
}

/**
 * Check whether `actingAs` may write to `holonId`/`lensName`.
 *
 * Tries the holosphere `canWrite` mixin first (federation-methods); falls
 * back to a simple "are we the owner?" check using the client public key.
 * Errors are swallowed and reported as `false` — call sites use this for UI
 * gating, not security enforcement.
 */
export async function canWriteToHolon(
  holosphere: HoloSphere,
  holonId: string,
  lensName: string,
  actingAs: ActingAsResolver
): Promise<boolean> {
  const acting = await resolveActingAs(actingAs);

  try {
    const hs = holosphere as any;
    if (typeof hs.canWrite === 'function') {
      const result = await hs.canWrite(holonId, lensName, acting, { actingAsHolon: acting });
      return result?.canWrite === true;
    }

    // Fallback: owner check — the bound private key owns the holon.
    if (hs.client?.publicKey === holonId) {
      return true;
    }

    return false;
  } catch (error) {
    console.warn('[canWriteToHolon] Error checking write access:', error);
    return false;
  }
}
