import type { HoloSphere } from 'holosphere';
// @ts-ignore — buildLensPath is exported from holosphere ESM but missing from type declarations
import { subscriptions, buildLensPath } from 'holosphere';

/**
 * Subscribe to a holon's lens with federation support.
 *
 * holosphere.subscribe() forces authors=[localPubKey], which prevents receiving
 * updates authored by federated partners. For federated holons, this helper uses
 * the low-level createSubscription to derive the author from the path instead.
 */
export async function subscribeWithFederationSupport(
  holosphere: HoloSphere,
  userPubKey: string,
  targetHolonId: string,
  lens: string,
  callback: (item: any, key?: string) => void
): Promise<() => void> {
  const isFederated = targetHolonId !== userPubKey;

  if (isFederated) {
    // GATEKEEPER: Verify federation is accepted before allowing subscription
    try {
      const federationInfo = await holosphere.getFederation(userPubKey);
      const federatedList = federationInfo?.federated || [];

      if (!federatedList.includes(targetHolonId)) {
        console.warn('[SubscriptionHelper] Blocked subscription to non-federated holon:', {
          targetHolonId: targetHolonId.slice(0, 8) + '...',
          lens
        });
        return () => {}; // Return no-op unsubscribe
      }
    } catch (err) {
      console.error('[SubscriptionHelper] Failed to verify federation:', err);
      return () => {}; // Fail closed - don't allow subscription if verification fails
    }

    const hs = holosphere as any;
    const appName: string | undefined = hs.config?.appName;
    const client = hs.client;

    if (!client || !appName) {
      console.warn('[SubscriptionHelper] Cannot subscribe to federated holon: missing client or appName');
      return () => {};
    }

    const path = buildLensPath(appName, targetHolonId, lens);

    try {
      const sub = await subscriptions.createSubscription(
        client, path, callback,
        { realtimeOnly: true, resolveHolograms: true, appname: appName }
      );
      return () => { sub?.unsubscribe?.(); };
    } catch (err) {
      console.error('[SubscriptionHelper] Failed to set up federated subscription:', err);
      return () => {};
    }
  }

  // For owned holons, use holosphere.subscribe() directly
  const sub = holosphere.subscribe(targetHolonId, lens, callback) as { unsubscribe?: () => void } | (() => void);

  return () => {
    if (sub && typeof sub === 'object' && 'unsubscribe' in sub && sub.unsubscribe) {
      sub.unsubscribe();
    } else if (typeof sub === 'function') {
      sub();
    }
  };
}
