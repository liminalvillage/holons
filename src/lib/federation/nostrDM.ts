/**
 * Nostr DM Federation Types
 *
 * Type definitions for federation handshake messages.
 * The actual implementation is in holosphere2's handshake module.
 */

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
