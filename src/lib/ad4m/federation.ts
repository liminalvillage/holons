/**
 * AD4M Federation Helper
 *
 * Provides AD4M-native federation via FederationLink subject class instances.
 * Only activated when ad4mConfig.mode is 'ad4m' or 'dual'.
 * When mode is 'holosphere', callers should use the existing Nostr DM handshake.
 *
 * @module ad4m/federation
 */

import { get } from 'svelte/store';
import { ad4mConfig } from './config';
import { HoloSphereAd4mAdapter } from './adapter';
import type { Ad4mConnectionConfig } from './connection';

/**
 * Request federation between two holons via AD4M perspective links.
 *
 * Creates a FederationLink in the source holon's perspective pointing
 * to the target neighbourhood URL. The target holon can discover
 * this link by querying their neighbourhood for FederationLink instances.
 *
 * @param adapter - The AD4M adapter instance
 * @param sourceHolonId - Source holon's perspective UUID
 * @param targetNeighbourhoodUrl - Target holon's neighbourhood URL
 * @param targetName - Display name for the target holon
 * @param inboundLenses - Lenses to accept from the target
 * @param outboundLenses - Lenses to share with the target
 */
export async function requestAd4mFederation(
  adapter: HoloSphereAd4mAdapter,
  sourceHolonId: string,
  targetNeighbourhoodUrl: string,
  targetName: string,
  inboundLenses: string[] = [],
  outboundLenses: string[] = [],
): Promise<void> {
  await adapter.federate(
    sourceHolonId,
    targetNeighbourhoodUrl,
    targetName,
    'federated',
    inboundLenses,
    outboundLenses,
  );
}

/**
 * Check whether AD4M federation should be used based on the current config mode.
 */
export function shouldUseAd4mFederation(): boolean {
  const config = get(ad4mConfig);
  return config.mode === 'ad4m';
}

/**
 * Get all federation links from a holon via the AD4M adapter.
 */
export async function getAd4mFederationLinks(
  adapter: HoloSphereAd4mAdapter,
  holonId: string,
): Promise<Record<string, any>> {
  return adapter.getFederation(holonId);
}

/**
 * Remove a federation link by deleting the FederationLink instance.
 */
export async function removeAd4mFederation(
  adapter: HoloSphereAd4mAdapter,
  holonId: string,
  linkId: string,
): Promise<void> {
  await adapter.delete(holonId, 'federation', linkId);
}
