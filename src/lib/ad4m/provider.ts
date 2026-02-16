/**
 * AD4M Svelte Context Provider
 *
 * Sets up the AD4M adapter and provides it via Svelte context.
 * Works alongside the existing HolosphereProvider — components that
 * use getContext('holosphere') continue to work unchanged.
 *
 * The provider reads the current mode from the ad4mConfig store and
 * wraps the HoloSphere instance in a DualWriteAdapter if AD4M is enabled.
 *
 * @module ad4m/provider
 */

import type { HoloSphere } from 'holosphere';
import { get } from 'svelte/store';
import { DualWriteAdapter } from './dual-adapter';
import { ad4mConfig } from './config';
import type { Ad4mConnectionConfig } from './connection';

/** Svelte context key for the DualWriteAdapter */
export const AD4M_CONTEXT_KEY = 'ad4m-adapter';

/** Svelte context key for AD4M connection status */
export const AD4M_STATUS_KEY = 'ad4m-status';

/**
 * Create a DualWriteAdapter from the current config and HoloSphere instance.
 *
 * This is called during component initialization to set up the adapter.
 * The adapter wraps HoloSphere and optionally routes to AD4M based on config.
 *
 * @param holosphere - The existing HoloSphere instance from context
 * @returns The configured DualWriteAdapter
 *
 * @example
 * ```typescript
 * // In a layout or provider component:
 * import { setContext } from 'svelte';
 * import { createDualAdapter, AD4M_CONTEXT_KEY } from '$lib/ad4m/provider';
 *
 * const holosphere = getContext('holosphere');
 * const adapter = createDualAdapter(holosphere);
 * setContext(AD4M_CONTEXT_KEY, adapter);
 * ```
 */
export function createDualAdapter(holosphere: HoloSphere): DualWriteAdapter {
  const config = get(ad4mConfig);

  const ad4mConnectionConfig: Ad4mConnectionConfig | undefined =
    config.mode !== 'holosphere'
      ? {
          executorUrl: config.executorUrl,
          token: config.token || undefined,
        }
      : undefined;

  const adapter = new DualWriteAdapter({
    holosphere,
    ad4mConfig: ad4mConnectionConfig,
    mode: config.mode,
    onDiscrepancy: (op, lens, hsResult, ad4mResult, details) => {
      console.warn(
        `[AD4M Dual] ${op}(${lens}): ${details || 'mismatch'}`,
        { holosphere: hsResult, ad4m: ad4mResult }
      );
    },
  });

  return adapter;
}

/**
 * Initialize the AD4M adapter connection (async).
 *
 * Call this after creating the adapter if AD4M mode is enabled.
 * In holosphere-only mode, this is a no-op.
 *
 * @param adapter - The DualWriteAdapter to initialize
 * @returns true if initialization succeeded, false otherwise
 */
export async function initAd4mAdapter(adapter: DualWriteAdapter): Promise<boolean> {
  try {
    await adapter.init();
    return true;
  } catch (error) {
    console.error('[AD4M Provider] Initialization failed:', error);
    return false;
  }
}

/**
 * Switch the adapter's backend mode at runtime.
 *
 * If switching to a mode that requires AD4M and it's not connected,
 * attempts to connect first.
 *
 * @param adapter - The DualWriteAdapter to switch
 * @param mode - The new backend mode
 * @returns true if mode switch succeeded
 */
export async function switchMode(
  adapter: DualWriteAdapter,
  mode: 'holosphere' | 'ad4m' | 'dual'
): Promise<boolean> {
  // If switching to AD4M mode and not connected, try to connect
  if (mode !== 'holosphere' && !adapter.isAd4mConnected) {
    const config = get(ad4mConfig);
    try {
      await adapter.connectAd4m({
        executorUrl: config.executorUrl,
        token: config.token || undefined,
      });
    } catch (error) {
      console.error('[AD4M Provider] Failed to connect AD4M for mode switch:', error);
      return false;
    }
  }

  adapter.mode = mode;
  ad4mConfig.setMode(mode);
  return true;
}
