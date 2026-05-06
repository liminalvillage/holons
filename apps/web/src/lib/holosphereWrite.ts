/**
 * Holosphere Write Utilities — web wrapper.
 *
 * The actual write/identity logic lives in `@holons/core/holosphere` so
 * the bot uses the same code path. This file just glues the core API to
 * Svelte stores: `actingAs` is read from `activeHolonIdentity`, and
 * denials are surfaced via `notifyWriteDenied`.
 */

import { get } from 'svelte/store';
import type { HoloSphere } from 'holosphere';
import {
  writeWithIdentity as coreWriteWithIdentity,
  canWriteToHolon as coreCanWriteToHolon,
  createHolonWriter as coreCreateHolonWriter,
  type WriteDeniedInfo,
} from '@holons/core/holosphere';
import { activeHolonIdentity } from './stores/activeHolonIdentity';
import { notifyWriteDenied } from './stores/writeNotifications';

/** Resolve the current acting-as identity from the Svelte store. */
const actingAsFromStore = () => get(activeHolonIdentity);

/** Default denial handler — show a toast notification. */
const defaultOnDenied = (info: WriteDeniedInfo): void => {
  notifyWriteDenied(`Unable to save - no write permission for this holon's ${info.lensName}`);
};

/**
 * Write to holosphere with active identity context and error handling.
 *
 * See `@holons/core/holosphere#writeWithIdentity` for the underlying logic.
 */
export function writeWithIdentity(
  holosphere: HoloSphere,
  holonId: string,
  lensName: string,
  data: any,
  options: { silent?: boolean } = {}
): Promise<boolean> {
  return coreWriteWithIdentity(holosphere, holonId, lensName, data, {
    actingAs: actingAsFromStore,
    onDenied: defaultOnDenied,
    silent: options.silent,
  });
}

/**
 * Check if we can write to a holon's lens before attempting the write.
 */
export function canWriteToHolon(
  holosphere: HoloSphere,
  holonId: string,
  lensName: string
): Promise<boolean> {
  return coreCanWriteToHolon(holosphere, holonId, lensName, actingAsFromStore);
}

/**
 * Create a pre-bound write function for a specific holon context.
 */
export function createHolonWriter(holosphere: HoloSphere, holonId: string) {
  return coreCreateHolonWriter(holosphere, holonId, {
    actingAs: actingAsFromStore,
    onDenied: defaultOnDenied,
  });
}
