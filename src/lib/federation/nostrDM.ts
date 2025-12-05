/**
 * Nostr DM Federation Protocol
 *
 * Uses NIP-04 encrypted DMs (kind 4) for federation request/response communication.
 * Enables bidirectional federation by notifying partners and allowing them to accept/reject.
 */

import type { HoloSphere } from 'holosphere';

// ============================================================================
// Types
// ============================================================================

export interface CapabilityInfo {
  lensName: string;
  direction: 'inbound' | 'outbound';
  token: string;
  expiresAt: number | null;
}

export interface FederationRequestDM {
  type: 'federation_request';
  version: '1.0';
  requestId: string;
  timestamp: number;
  senderHolonId: string;
  senderHolonName: string;
  senderNpub: string;
  lensConfig: {
    inbound: string[];
    outbound: string[];
  };
  capabilities: CapabilityInfo[];
  message?: string;
}

export interface FederationResponseDM {
  type: 'federation_response';
  version: '1.0';
  requestId: string;
  timestamp: number;
  status: 'accepted' | 'rejected';
  responderHolonId?: string;
  responderHolonName?: string;
  responderNpub?: string;
  lensConfig?: {
    inbound: string[];
    outbound: string[];
  };
  capabilities?: CapabilityInfo[];
  message?: string;
}

export type FederationDMPayload = FederationRequestDM | FederationResponseDM;

// ============================================================================
// NIP-04 Encryption (using nostr-tools)
// ============================================================================

/**
 * Convert hex string to Uint8Array
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

/**
 * Encrypt a message using NIP-04
 */
export async function encryptNIP04(
  privateKey: string,
  recipientPubKey: string,
  content: string
): Promise<string> {
  const { nip04 } = await import('nostr-tools');
  return await nip04.encrypt(privateKey, recipientPubKey, content);
}

/**
 * Decrypt a NIP-04 encrypted message
 */
export async function decryptNIP04(
  privateKey: string,
  senderPubKey: string,
  encryptedContent: string
): Promise<string> {
  const { nip04 } = await import('nostr-tools');
  return await nip04.decrypt(privateKey, senderPubKey, encryptedContent);
}

// ============================================================================
// DM Sending
// ============================================================================

/**
 * Generate a unique request ID
 */
export function generateRequestId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 10);
}

/**
 * Send a federation request DM to a partner
 */
export async function sendFederationRequest(
  holosphere: HoloSphere,
  privateKey: string,
  recipientPubKey: string,
  request: FederationRequestDM
): Promise<boolean> {
  try {
    const content = JSON.stringify(request);
    const encryptedContent = await encryptNIP04(privateKey, recipientPubKey, content);

    // Create NIP-04 event (kind 4)
    const nostrTools = await import('nostr-tools');
    const pubKey = nostrTools.getPublicKey(hexToBytes(privateKey));

    const event = {
      kind: 4,
      pubkey: pubKey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', recipientPubKey]],
      content: encryptedContent
    };

    // Sign the event
    const signedEvent = nostrTools.finalizeEvent(event, hexToBytes(privateKey));

    // Publish via holosphere's Nostr client
    if (holosphere.client?.publish) {
      await holosphere.client.publish(signedEvent);
      console.log('Federation request DM sent to:', recipientPubKey.substring(0, 8) + '...');
      return true;
    } else {
      console.error('No Nostr client available for publishing');
      return false;
    }
  } catch (error) {
    console.error('Failed to send federation request DM:', error);
    return false;
  }
}

/**
 * Send a federation response DM
 */
export async function sendFederationResponse(
  holosphere: HoloSphere,
  privateKey: string,
  recipientPubKey: string,
  response: FederationResponseDM
): Promise<boolean> {
  try {
    const content = JSON.stringify(response);
    const encryptedContent = await encryptNIP04(privateKey, recipientPubKey, content);

    const nostrTools = await import('nostr-tools');
    const pubKey = nostrTools.getPublicKey(hexToBytes(privateKey));

    const event = {
      kind: 4,
      pubkey: pubKey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', recipientPubKey]],
      content: encryptedContent
    };

    const signedEvent = nostrTools.finalizeEvent(event, hexToBytes(privateKey));

    if (holosphere.client?.publish) {
      await holosphere.client.publish(signedEvent);
      console.log('Federation response DM sent to:', recipientPubKey.substring(0, 8) + '...');
      return true;
    } else {
      console.error('No Nostr client available for publishing');
      return false;
    }
  } catch (error) {
    console.error('Failed to send federation response DM:', error);
    return false;
  }
}

// ============================================================================
// DM Subscription
// ============================================================================

/**
 * Subscribe to incoming federation DMs
 * Returns an unsubscribe function
 */
export function subscribeToFederationDMs(
  holosphere: HoloSphere,
  privateKey: string,
  publicKey: string,
  onRequest: (request: FederationRequestDM, senderPubKey: string) => void,
  onResponse: (response: FederationResponseDM, senderPubKey: string) => void
): () => void {
  let isActive = true;
  const processedEventIds = new Set<string>();

  const handleEvent = async (event: any) => {
    if (!isActive) return;

    // Skip if we've already processed this event
    if (processedEventIds.has(event.id)) return;
    processedEventIds.add(event.id);

    // Only process kind 4 (encrypted DM) events tagged to us
    if (event.kind !== 4) return;

    const pTag = event.tags?.find((t: string[]) => t[0] === 'p');
    if (!pTag || pTag[1] !== publicKey) return;

    try {
      // Decrypt the message
      const decrypted = await decryptNIP04(privateKey, event.pubkey, event.content);
      const payload = JSON.parse(decrypted) as FederationDMPayload;

      // Route to appropriate handler
      if (payload.type === 'federation_request') {
        console.log('Received federation request from:', event.pubkey.substring(0, 8) + '...');
        onRequest(payload, event.pubkey);
      } else if (payload.type === 'federation_response') {
        console.log('Received federation response from:', event.pubkey.substring(0, 8) + '...');
        onResponse(payload, event.pubkey);
      }
    } catch (error) {
      // Silently ignore DMs that aren't federation-related or can't be decrypted
      // This is normal since users receive many DMs
    }
  };

  // Subscribe to DMs via holosphere's Nostr client
  let subscription: any = null;

  const startSubscription = async () => {
    if (!holosphere.client?.subscribe) {
      console.warn('No Nostr client available for DM subscription');
      return;
    }

    const filter = {
      kinds: [4],
      '#p': [publicKey],
      since: Math.floor(Date.now() / 1000) - 86400 // Last 24 hours
    };

    try {
      subscription = holosphere.client.subscribe([filter], {
        onevent: handleEvent,
        oneose: () => {
          console.log('Federation DM subscription caught up to present');
        }
      });
    } catch (error) {
      console.error('Failed to subscribe to federation DMs:', error);
    }
  };

  startSubscription();

  // Return unsubscribe function
  return () => {
    isActive = false;
    if (subscription?.close) {
      subscription.close();
    }
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a DM payload is a federation request
 */
export function isFederationRequest(payload: any): payload is FederationRequestDM {
  return payload?.type === 'federation_request' && payload?.version === '1.0';
}

/**
 * Check if a DM payload is a federation response
 */
export function isFederationResponse(payload: any): payload is FederationResponseDM {
  return payload?.type === 'federation_response' && payload?.version === '1.0';
}

/**
 * Create a federation request payload
 */
export function createFederationRequest(
  senderHolonId: string,
  senderHolonName: string,
  senderNpub: string,
  lensConfig: { inbound: string[]; outbound: string[] },
  capabilities: CapabilityInfo[],
  message?: string
): FederationRequestDM {
  return {
    type: 'federation_request',
    version: '1.0',
    requestId: generateRequestId(),
    timestamp: Date.now(),
    senderHolonId,
    senderHolonName,
    senderNpub,
    lensConfig,
    capabilities,
    message
  };
}

/**
 * Create a federation response payload
 */
export function createFederationResponse(
  requestId: string,
  status: 'accepted' | 'rejected',
  responderHolonId?: string,
  responderHolonName?: string,
  responderNpub?: string,
  lensConfig?: { inbound: string[]; outbound: string[] },
  capabilities?: CapabilityInfo[],
  message?: string
): FederationResponseDM {
  return {
    type: 'federation_response',
    version: '1.0',
    requestId,
    timestamp: Date.now(),
    status,
    responderHolonId,
    responderHolonName,
    responderNpub,
    lensConfig,
    capabilities,
    message
  };
}
