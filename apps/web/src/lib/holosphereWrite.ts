/**
 * Holosphere Write Utilities
 *
 * Provides wrapped write operations that:
 * 1. Pass the activeHolonIdentity as the "actingAs" option
 * 2. Handle AuthorizationError and show notifications
 */

import { get } from 'svelte/store';
import { activeHolonIdentity } from './stores/activeHolonIdentity';
import { notifyWriteDenied } from './stores/writeNotifications';
import type { HoloSphere } from 'holosphere';

/**
 * Write to holosphere with active identity context and error handling.
 *
 * @param holosphere - The HoloSphere instance
 * @param holonId - The target holon ID
 * @param lensName - The lens to write to
 * @param data - The data to write
 * @param options - Additional options
 * @returns Promise that resolves when write completes
 * @throws Re-throws non-authorization errors
 */
export async function writeWithIdentity(
  holosphere: HoloSphere,
  holonId: string,
  lensName: string,
  data: any,
  options: { silent?: boolean } = {}
): Promise<boolean> {
  const actingAs = get(activeHolonIdentity);

  try {
    await holosphere.put(holonId, lensName, data, { actingAs });
    return true;
  } catch (error: any) {
    if (error?.name === 'AuthorizationError' || error?.message?.includes('Write access denied')) {
      if (!options.silent) {
        notifyWriteDenied(`Unable to save - no write permission for this holon's ${lensName}`);
      }
      console.warn('[writeWithIdentity] Write denied:', {
        holonId: holonId?.slice(0, 12) + '...',
        lensName,
        actingAs: actingAs?.slice(0, 12) + '...',
        error: error.message
      });
      return false;
    }
    // Re-throw other errors
    throw error;
  }
}

/**
 * Check if we can write to a holon's lens before attempting the write.
 *
 * @param holosphere - The HoloSphere instance
 * @param holonId - The target holon ID
 * @param lensName - The lens to check
 * @returns Promise<boolean> - true if write is allowed
 */
export async function canWriteToHolon(
  holosphere: HoloSphere,
  holonId: string,
  lensName: string
): Promise<boolean> {
  const actingAs = get(activeHolonIdentity);

  try {
    // Use the canWrite method if available (added by federation-methods mixin)
    const hs = holosphere as any;
    if (typeof hs.canWrite === 'function') {
      const result = await hs.canWrite(holonId, lensName, actingAs, { actingAsHolon: actingAs });
      return result?.canWrite === true;
    }

    // Fallback: check if we're the owner
    const client = hs.client;
    if (client?.publicKey === holonId) {
      return true;
    }

    return false;
  } catch (error) {
    console.warn('[canWriteToHolon] Error checking write access:', error);
    return false;
  }
}

/**
 * Create a pre-bound write function for a specific holon context.
 * Useful for components that write frequently to the same holon.
 *
 * @param holosphere - The HoloSphere instance
 * @param holonId - The target holon ID
 * @returns Object with put and canWrite methods
 */
export function createHolonWriter(holosphere: HoloSphere, holonId: string) {
  return {
    put: (lensName: string, data: any, options?: { silent?: boolean }) =>
      writeWithIdentity(holosphere, holonId, lensName, data, options),

    canWrite: (lensName: string) =>
      canWriteToHolon(holosphere, holonId, lensName)
  };
}
