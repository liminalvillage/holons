import type { HoloSphere } from 'holosphere';

/**
 * Set up a subscription to a holon's lens with enhanced logging for debugging.
 * Works for both owned and federated holons - the underlying Nostr subscription
 * will receive events from any pubkey.
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

  // Use regular subscription for all holons
  // The Nostr subscription will receive events from the target holon's pubkey
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
