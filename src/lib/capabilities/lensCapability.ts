/**
 * Lens Capability Token Types and Utilities
 *
 * Provides per-lens capability tokens for federation access control.
 * Capabilities can be granted/revoked independently for each lens (quests, offers, etc.)
 * with configurable expiration.
 */

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
// Bech32 Implementation (browser-compatible, no Buffer dependency)
// ============================================================================

const BECH32_ALPHABET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function bech32Polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((b >> i) & 1) {
        chk ^= GEN[i];
      }
    }
  }
  return chk;
}

function bech32HrpExpand(hrp: string): number[] {
  const ret: number[] = [];
  for (let i = 0; i < hrp.length; i++) {
    ret.push(hrp.charCodeAt(i) >> 5);
  }
  ret.push(0);
  for (let i = 0; i < hrp.length; i++) {
    ret.push(hrp.charCodeAt(i) & 31);
  }
  return ret;
}

function bech32VerifyChecksum(hrp: string, data: number[]): boolean {
  return bech32Polymod(bech32HrpExpand(hrp).concat(data)) === 1;
}

function bech32CreateChecksum(hrp: string, data: number[]): number[] {
  const values = bech32HrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
  const polymod = bech32Polymod(values) ^ 1;
  const ret: number[] = [];
  for (let i = 0; i < 6; i++) {
    ret.push((polymod >> (5 * (5 - i))) & 31);
  }
  return ret;
}

function bech32Decode(str: string): { hrp: string; data: number[] } | null {
  if (str.length < 8 || str.length > 90) return null;

  const lowered = str.toLowerCase();
  const uppered = str.toUpperCase();
  if (str !== lowered && str !== uppered) return null;

  str = lowered;
  const pos = str.lastIndexOf('1');
  if (pos < 1 || pos + 7 > str.length) return null;

  const hrp = str.substring(0, pos);
  const data: number[] = [];

  for (let i = pos + 1; i < str.length; i++) {
    const idx = BECH32_ALPHABET.indexOf(str[i]);
    if (idx === -1) return null;
    data.push(idx);
  }

  if (!bech32VerifyChecksum(hrp, data)) return null;

  return { hrp, data: data.slice(0, -6) };
}

function bech32Encode(hrp: string, data: number[]): string {
  const checksum = bech32CreateChecksum(hrp, data);
  const combined = data.concat(checksum);
  let result = hrp + '1';
  for (const d of combined) {
    result += BECH32_ALPHABET[d];
  }
  return result;
}

function convertBits(data: number[], fromBits: number, toBits: number, pad: boolean): number[] | null {
  let acc = 0;
  let bits = 0;
  const ret: number[] = [];
  const maxv = (1 << toBits) - 1;

  for (const value of data) {
    if (value < 0 || value >> fromBits !== 0) return null;
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      ret.push((acc >> bits) & maxv);
    }
  }

  if (pad) {
    if (bits > 0) {
      ret.push((acc << (toBits - bits)) & maxv);
    }
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv)) {
    return null;
  }

  return ret;
}

function hexToBytes(hex: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substr(i, 2), 16));
  }
  return bytes;
}

function bytesToHex(bytes: number[]): string {
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ============================================================================
// Nostr Key Utilities
// ============================================================================

/**
 * Parse an npub or hex public key string into hex format
 */
export function parseNpubOrHex(input: string): ParsedNpubResult {
  const trimmed = input.trim();

  if (!trimmed) {
    return { valid: false, error: 'Public key is required' };
  }

  // Check if it's already hex (64 characters)
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return { valid: true, hexPubKey: trimmed.toLowerCase() };
  }

  // Handle nostr: URI prefix
  let npubString = trimmed;
  if (npubString.startsWith('nostr:')) {
    npubString = npubString.slice(6);
  }

  // Try to decode as npub
  if (npubString.startsWith('npub1')) {
    try {
      const decoded = bech32Decode(npubString);
      if (!decoded || decoded.hrp !== 'npub') {
        return { valid: false, error: 'Invalid npub format' };
      }
      const bytes = convertBits(decoded.data, 5, 8, false);
      if (!bytes || bytes.length !== 32) {
        return { valid: false, error: 'Invalid npub: wrong length' };
      }
      return { valid: true, hexPubKey: bytesToHex(bytes) };
    } catch (e) {
      return { valid: false, error: 'Invalid npub: unable to decode' };
    }
  }

  return { valid: false, error: 'Enter a valid npub (npub1...) or 64-character hex public key' };
}

/**
 * Convert a hex public key to npub format
 */
export function hexToNpub(hexPubKey: string): string {
  try {
    const bytes = hexToBytes(hexPubKey);
    const words = convertBits(bytes, 8, 5, true);
    if (!words) {
      console.error('Failed to convert bits for npub encoding');
      return hexPubKey;
    }
    return bech32Encode('npub', words);
  } catch (e) {
    console.error('Failed to encode hex to npub:', e);
    return hexPubKey; // Return original on error
  }
}

/**
 * Shorten a public key for display (first 8 and last 8 chars)
 */
export function shortenPubKey(pubKey: string): string {
  if (pubKey.length <= 20) return pubKey;
  return `${pubKey.slice(0, 8)}...${pubKey.slice(-8)}`;
}

/**
 * Shorten an npub for display
 */
export function shortenNpub(npub: string): string {
  if (npub.length <= 20) return npub;
  return `${npub.slice(0, 12)}...${npub.slice(-8)}`;
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

/**
 * Generate a random nonce for capability token
 */
export function generateNonce(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 15);
}

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
