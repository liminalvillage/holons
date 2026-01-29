import type { HoloSphere } from 'holosphere';

/**
 * Set up a subscription to a holon's lens with enhanced logging for debugging.
 * For owned holons, subscribes to real-time updates.
 * For federated holons, skips real-time subscription (defense-in-depth);
 * federated data is loaded via getAll() which has proper authorization checks.
 *
 * @param holosphere - The HoloSphere instance
 * @param userPubKey - The current user's public key (for logging)
 * @param targetHolonId - The holon ID to subscribe to
 * @param lens - The lens name to subscribe to
 * @param callback - Callback function for updates
 * @returns Unsubscribe function
 */
export async function subscribeWithFederationSupport(
  holosphere: HoloSphere,
  userPubKey: string,
  targetHolonId: string,
  lens: string,
  callback: (item: any, key?: string) => void
): Promise<() => void> {
  const isFederated = targetHolonId !== userPubKey;

  // Defense-in-depth: skip real-time subscriptions for non-owned holons.
  // holosphere.subscribe() now has its own authorization check, but this
  // provides an additional guard at the client layer.
  // Federated data is still loaded via getAll() which has proper auth.
  if (isFederated) {
    console.log('[SubscriptionHelper] Skipping subscription for federated holon (defense-in-depth):', {
      targetHolonId: targetHolonId.slice(0, 12),
      lens,
      userPubKey: userPubKey?.slice(0, 12)
    });
    return () => {};
  }

  console.log('[SubscriptionHelper] Setting up subscription:', {
    targetHolonId: targetHolonId.slice(0, 12),
    lens,
    isFederated,
    userPubKey: userPubKey?.slice(0, 12)
  });

  // Wrap callback to add logging
  const wrappedCallback = (item: any, key?: string) => {
    console.log('[SubscriptionHelper] Subscription callback received:', {
      targetHolonId: targetHolonId.slice(0, 12),
      lens,
      isFederated,
      itemId: item?.id || key,
      itemTitle: item?.title,
      isDeleted: !item || item._deleted
    });
    callback(item, key);
  };

  // Subscribe to real-time updates for owned holon
  const sub = holosphere.subscribe(targetHolonId, lens, wrappedCallback) as { unsubscribe?: () => void } | (() => void);

  console.log('[SubscriptionHelper] Subscription created for:', {
    targetHolonId: targetHolonId.slice(0, 12),
    lens,
    subscriptionType: typeof sub
  });

  return () => {
    console.log('[SubscriptionHelper] Unsubscribing from:', {
      targetHolonId: targetHolonId.slice(0, 12),
      lens
    });
    if (sub && typeof sub === 'object' && 'unsubscribe' in sub && sub.unsubscribe) {
      sub.unsubscribe();
    } else if (typeof sub === 'function') {
      sub();
    }
  };
}
