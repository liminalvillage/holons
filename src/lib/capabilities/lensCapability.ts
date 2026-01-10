/**
 * Lens Capability Token Types and Utilities - V2
 *
 * Provides per-lens capability tokens for federation access control.
 * V2 Changes:
 * - Tokens are now permanent (no expiration)
 * - Revocation replaces expiration for access control
 * - Capability IDs use cap_xxx format for tracking
 */

import { nostrUtils } from 'holosphere';

// Re-export utility functions for local use
const { generateNonce, hexToNpub, parseNpubOrHex, shortenNpub, shortenPubKey } = nostrUtils;

// ============================================================================
// Types
// ============================================================================

export type Permission = 'read' | 'write' | 'delete';

export type Direction = 'inbound' | 'outbound';

/**
 * V2 Lens Capability Token
 */
export interface LensCapabilityToken {
  /** Unique identifier for revocation (cap_xxx format) */
  id: string;
  /** Token version */
  version: '2.0';
  /** Token type marker */
  type: 'capability';
  /** Nostr public key of the grantor (hex format) */
  issuerPubKey: string;
  /** Nostr public key of the recipient (hex format) */
  recipientPubKey: string;
  /** Holon ID this capability applies to (or '*' for all) */
  holonId: string;
  /** Specific lens (quests, offers, etc.) or '*' for all */
  lensName: string;
  /** Data ID scope (usually '*') */
  dataId: string;
  /** Array of permissions granted */
  permissions: Permission[];
  /** inbound = READ capability, outbound = WRITE capability */
  direction: Direction;
  /** Unix timestamp when issued */
  issuedAt: number;
  /** Whether this is a self-capability (same issuer/recipient) */
  isSelfCapability: boolean;
  /** Unique nonce for replay protection */
  nonce: string;
  /** Cryptographic signature from issuer */
  signature?: string;
  /** Whether this capability has been revoked */
  revoked?: boolean;
  /** Reason for revocation if revoked */
  revokedReason?: string;
  /** Timestamp when revoked */
  revokedAt?: number;
}

export interface PartnerCapabilities {
  /** Partner's Nostr public key (hex) */
  pubKey: string;
  /** Partner's npub format */
  npub?: string;
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
// Capability Validation (V2 - Revocation-based)
// ============================================================================

/**
 * Check if a capability token is currently valid (not revoked)
 * V2: No expiration check - only revocation
 */
export function isCapabilityValid(token: LensCapabilityToken): boolean {
  return !token.revoked;
}

/**
 * Get status description for a capability
 */
export function getCapabilityStatus(token: LensCapabilityToken): string {
  if (token.revoked) {
    return token.revokedReason ? `Revoked: ${token.revokedReason}` : 'Revoked';
  }
  return 'Active';
}

/**
 * Get status color class for a capability
 */
export function getCapabilityStatusColor(token: LensCapabilityToken): string {
  if (token.revoked) {
    return 'text-red-400';
  }
  return 'text-green-400';
}

// ============================================================================
// Capability Token Utilities
// ============================================================================

/**
 * Generate a unique capability ID (V2 format: cap_xxx)
 */
export function generateCapabilityId(): string {
  const nonce = generateNonce();
  return `cap_${nonce.slice(0, 16)}`;
}

/**
 * Generate a legacy-style capability ID (for backwards compatibility)
 */
export function generateLegacyCapabilityId(
  issuerPubKey: string,
  recipientPubKey: string,
  holonId: string,
  lensName: string,
  direction: Direction
): string {
  return `${issuerPubKey.slice(0, 8)}_${recipientPubKey.slice(0, 8)}_${holonId.slice(0, 8)}_${lensName}_${direction}`;
}

// Re-export utilities from holosphere
export { generateNonce, hexToNpub, parseNpubOrHex, shortenNpub, shortenPubKey };

/**
 * Get permissions based on direction
 * - inbound (we receive their data) = ['read']
 * - outbound (we share our data) = ['read'] for them to read
 */
export function getPermissionsForDirection(direction: Direction): Permission[] {
  return ['read'];
}

/**
 * Create a new V2 capability token record (unsigned - signing happens via holosphere)
 */
export function createCapabilityRecord(
  issuerPubKey: string,
  recipientPubKey: string,
  holonId: string,
  lensName: string,
  direction: Direction,
  permissions: Permission[] = ['read']
): Omit<LensCapabilityToken, 'signature'> {
  const now = Date.now();

  return {
    id: generateCapabilityId(),
    version: '2.0',
    type: 'capability',
    issuerPubKey,
    recipientPubKey,
    holonId,
    lensName,
    dataId: '*',
    permissions,
    direction,
    issuedAt: now,
    isSelfCapability: issuerPubKey === recipientPubKey,
    nonce: generateNonce()
  };
}

// ============================================================================
// Display Helpers
// ============================================================================

/**
 * Format issued date for display
 */
export function formatIssuedDate(issuedAt: number): string {
  const date = new Date(issuedAt);
  return date.toLocaleDateString();
}

/**
 * Get human-readable capability description
 */
export function getCapabilityDescription(token: LensCapabilityToken): string {
  const permStr = token.permissions.join(', ');
  const scope = token.lensName === '*' ? 'all lenses' : token.lensName;
  return `${permStr} access to ${scope}`;
}

/**
 * Get direction label
 */
export function getDirectionLabel(direction: Direction): string {
  return direction === 'inbound' ? 'Receiving' : 'Sharing';
}

/**
 * Get direction color class
 */
export function getDirectionColor(direction: Direction): string {
  return direction === 'inbound' ? 'text-blue-400' : 'text-green-400';
}
