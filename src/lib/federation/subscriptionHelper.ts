import type { HoloSphere } from 'holosphere';

/**
 * Subscribe to a holon's lens with federation support.
 *
 * For both owned and federated holons, uses holosphere.subscribe() which
 * handles the Gun path resolution internally.
 */
export async function subscribeWithFederationSupport(
  holosphere: HoloSphere,
  userPubKey: string,
  targetHolonId: string,
  lens: string,
  callback: (item: any, key?: string) => void
): Promise<() => void> {
  const sub = await holosphere.subscribe(targetHolonId, lens, callback) as { unsubscribe?: () => void } | (() => void);

  return () => {
    if (sub && typeof sub === 'object' && 'unsubscribe' in sub && sub.unsubscribe) {
      sub.unsubscribe();
    } else if (typeof sub === 'function') {
      sub();
    }
  };
}
