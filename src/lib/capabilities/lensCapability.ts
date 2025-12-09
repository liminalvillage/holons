/**
 * Lens Capability Token Types and Utilities
 *
 * Provides per-lens capability tokens for federation access control.
 * Capabilities can be granted/revoked independently for each lens (quests, offers, etc.)
 * with configurable expiration.
 */

import { bech32 } from '@scure/base';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { nostrUtils } from 'holosphere';

// Re-export utility functions for local use
const { generateNonce, hexToNpub, parseNpubOrHex, shortenNpub, shortenPubKey } = nostrUtils;

// ============================================================================
// Types
// ============================================================================

export type ExpirationPreset = 'permanent' | '30days' | '1year' | 'custom';

export type Permission = 'read' | 'write' | 'delete';

export type Direction = 'inbound' | 'outbound';

export interface LensCapabilityToken {
  /** Unique identifier: {issuerPubKey}_{recipientPubKey}_{holonId}_{lensName}_{direction} */
  id: string;
  /** Token type marker */
  type: 'lens_capability';
  /** Nostr public key of the grantor (hex format) */
  issuerPubKey: string;
  /** Nostr public key of the recipient (hex format) */
  recipientPubKey: string;
  /** Holon ID this capability applies to */
  holonId: string;
  /** Specific lens (quests, offers, etc.) */
  lensName: string;
  /** Array of permissions granted */
  permissions: Permission[];
  /** inbound = READ capability, outbound = WRITE capability */
  direction: Direction;
  /** Unix timestamp when issued */
  issuedAt: number;
  /** Unix timestamp when expires, or null for permanent */
  expiresAt: number | null;
  /** The preset used when creating */
  expirationPreset: ExpirationPreset;
  /** Unique nonce for replay protection */
  nonce: string;
  /** Cryptographic signature from issuer */
  signature: string;
  /** Unix timestamp if revoked */
  revokedAt?: number;
  /** Optional reason for revocation */
  revokedReason?: string;
}

export interface PartnerCapabilities {
  /** Partner's Nostr public key (hex) */
  pubKey: string;
  /** Partner's npub format */
  npub: string;
  /** Optional human-readable alias */
  alias?: string;
  /** Per-lens capabilities */
  lensCapabilities: Record<string, {
    inbound?: LensCapabilityToken;
    outbound?: LensCapabilityToken;
  }>;
}

export interface ParsedNpubResult {
  valid: boolean;
  hexPubKey?: string;
  error?: string;
}

// ============================================================================
// Expiration Utilities
// ============================================================================

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Calculate the expiration timestamp based on preset
 */
export function getExpirationTimestamp(
  preset: ExpirationPreset,
  customDate?: string
): number | null {
  const now = Date.now();

  switch (preset) {
    case 'permanent':
      return null;
    case '30days':
      return now + (30 * MILLISECONDS_PER_DAY);
    case '1year':
      return now + (365 * MILLISECONDS_PER_DAY);
    case 'custom':
      if (customDate) {
        const date = new Date(customDate);
        // Set to end of day in local timezone
        date.setHours(23, 59, 59, 999);
        return date.getTime();
      }
      return null;
    default:
      return null;
  }
}

/**
 * Check if a capability token is currently valid (not expired, not revoked)
 */
export function isCapabilityValid(token: LensCapabilityToken): boolean {
  if (token.revokedAt) {
    return false;
  }
  if (token.expiresAt && token.expiresAt <= Date.now()) {
    return false;
  }
  return true;
}

/**
 * Format expiration for display
 */
export function formatExpiration(expiresAt: number | null): string {
  if (expiresAt === null) {
    return 'permanent';
  }

  const now = Date.now();
  const diff = expiresAt - now;

  if (diff <= 0) {
    return 'expired';
  }

  const days = Math.ceil(diff / MILLISECONDS_PER_DAY);

  if (days <= 1) {
    return '< 1d';
  }
  if (days <= 30) {
    return `${days}d`;
  }
  if (days <= 365) {
    const months = Math.round(days / 30);
    return `${months}mo`;
  }

  const years = Math.round(days / 365);
  return `${years}y`;
}

/**
 * Get human-readable expiration description
 */
export function getExpirationDescription(expiresAt: number | null): string {
  if (expiresAt === null) {
    return 'Never expires';
  }

  const now = Date.now();
  if (expiresAt <= now) {
    return 'Expired';
  }

  const date = new Date(expiresAt);
  return `Expires ${date.toLocaleDateString()}`;
}

// ============================================================================
// Capability Token Utilities
// ============================================================================

/**
 * Generate a unique capability token ID
 */
export function generateCapabilityId(
  issuerPubKey: string,
  recipientPubKey: string,
  holonId: string,
  lensName: string,
  direction: Direction
): string {
  return `${issuerPubKey}_${recipientPubKey}_${holonId}_${lensName}_${direction}`;
}

// Re-export utilities from holosphere
export { generateNonce, hexToNpub, parseNpubOrHex, shortenNpub, shortenPubKey };

/**
 * Get permissions based on direction
 * - inbound (partner can read my data) = ['read']
 * - outbound (partner can write to my holon) = ['write']
 */
export function getPermissionsForDirection(direction: Direction): Permission[] {
  return direction === 'inbound' ? ['read'] : ['write'];
}

/**
 * Create a new capability token record (unsigned - signing happens via holosphere)
 */
export function createCapabilityRecord(
  issuerPubKey: string,
  recipientPubKey: string,
  holonId: string,
  lensName: string,
  direction: Direction,
  expirationPreset: ExpirationPreset,
  customExpirationDate?: string
): Omit<LensCapabilityToken, 'signature'> {
  const now = Date.now();

  return {
    id: generateCapabilityId(issuerPubKey, recipientPubKey, holonId, lensName, direction),
    type: 'lens_capability',
    issuerPubKey,
    recipientPubKey,
    holonId,
    lensName,
    permissions: getPermissionsForDirection(direction),
    direction,
    issuedAt: now,
    expiresAt: getExpirationTimestamp(expirationPreset, customExpirationDate),
    expirationPreset,
    nonce: generateNonce()
  };
}

// ============================================================================
// Preset Display Helpers
// ============================================================================

export interface ExpirationOption {
  value: ExpirationPreset;
  label: string;
  description: string;
}

export const EXPIRATION_OPTIONS: ExpirationOption[] = [
  { value: 'permanent', label: 'Permanent', description: 'Never expires' },
  { value: '30days', label: '30 Days', description: 'Expires in 30 days' },
  { value: '1year', label: '1 Year', description: 'Expires in 1 year' },
  { value: 'custom', label: 'Custom', description: 'Choose a specific date' }
];

/**
 * Get minimum date for custom expiration (today)
 */
export function getMinExpirationDate(): string {
  return new Date().toISOString().split('T')[0];
}
