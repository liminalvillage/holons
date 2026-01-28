/**
 * QR Capability Token Types and Utilities
 *
 * Provides capability tokens for QR code actions. When a holon owner generates
 * QR codes (e.g., for physical cards), they sign capability tokens that authorize
 * specific actions on their holon. The capability is embedded in the QR URL and
 * verified before any write operation.
 *
 * Security model:
 * - Only the holon owner can create valid capabilities (signature proves ownership)
 * - Capabilities are scoped to specific lenses/actions
 * - All capabilities have expiration times
 * - Optional use count limits for single-use or limited-use tokens
 */

import { schnorr } from '@noble/curves/secp256k1';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { sha256 } from '@noble/hashes/sha256';

// ============================================================================
// Types
// ============================================================================

export type CapabilityExpiration = 'permanent' | '24h' | '7d' | '30d' | '1year' | 'custom';

export interface QRCapabilityToken {
	/** Unique identifier for this capability */
	id: string;

	/** Token type marker */
	type: 'qr_capability';

	/** Nostr public key of the holon owner who issued this capability (hex format) */
	issuerPubKey: string;

	/** The holon this capability grants access to */
	holonId: string;

	/** Specific lens(es) the capability allows writing to */
	allowedLenses: string[];

	/** Action types permitted (if empty, determined by allowedLenses) */
	allowedActions: string[];

	/** Specific item title if capability is for a single item (optional) */
	itemId?: string;

	/** Unix timestamp (ms) when capability was issued */
	issuedAt: number;

	/** Unix timestamp (ms) when capability expires */
	expiresAt: number;

	/** Maximum number of uses (null = unlimited) */
	maxUses: number | null;

	/** Current use count (for stored capabilities) */
	useCount: number;

	/** Unique nonce for replay protection */
	nonce: string;

	/** Schnorr signature from issuer over the capability fields */
	signature: string;

	/** Metadata about the card/deck (for audit purposes) */
	metadata?: {
		deckId?: string;
		cardId?: string;
		cardTitle?: string;
		cardType?: string;
	};
}

export interface CreateQRCapabilityOptions {
	/** Target holon ID (must match issuer's public key for owner-issued capabilities) */
	holonId: string;

	/** Issuer's private key (hex format) */
	issuerPrivateKey: string;

	/** Which lenses can be written to */
	allowedLenses: string[];

	/** Which action types are permitted */
	allowedActions: string[];

	/** Optional: restrict to specific item by title */
	itemId?: string;

	/** Expiration preset or custom timestamp */
	expiration: CapabilityExpiration;

	/** Custom expiration timestamp (ms) - required if expiration is 'custom' */
	customExpiresAt?: number;

	/** Maximum uses (null = unlimited) */
	maxUses?: number | null;

	/** Card metadata for audit */
	metadata?: {
		deckId?: string;
		cardId?: string;
		cardTitle?: string;
		cardType?: string;
	};
}

export interface CapabilityValidationResult {
	valid: boolean;
	reason?: string;
	code?:
		| 'VALID'
		| 'INVALID_SIGNATURE'
		| 'EXPIRED'
		| 'ISSUER_NOT_OWNER'
		| 'ACTION_NOT_ALLOWED'
		| 'LENS_NOT_ALLOWED'
		| 'ITEM_MISMATCH'
		| 'USE_LIMIT_EXCEEDED'
		| 'MALFORMED';
}

// ============================================================================
// Constants
// ============================================================================

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;
const MILLISECONDS_PER_DAY = 24 * MILLISECONDS_PER_HOUR;

// Map card types to their corresponding lenses
const ACTION_TO_LENS_MAP: Record<string, string> = {
	role: 'roles',
	task: 'quests',
	action: 'quests',
	event: 'quests',
	badge: 'badges',
	invite: 'invites',
	resource: 'resources',
	vibe: 'vibes'
};

// ============================================================================
// Expiration Utilities
// ============================================================================

/**
 * Calculate expiration timestamp from preset
 */
export function getExpirationTimestamp(
	preset: CapabilityExpiration,
	customExpiresAt?: number
): number {
	const now = Date.now();

	switch (preset) {
		case 'permanent':
			// "Permanent" = 100 years (still has a technical expiration)
			return now + 100 * 365 * MILLISECONDS_PER_DAY;
		case '24h':
			return now + MILLISECONDS_PER_DAY;
		case '7d':
			return now + 7 * MILLISECONDS_PER_DAY;
		case '30d':
			return now + 30 * MILLISECONDS_PER_DAY;
		case '1year':
			return now + 365 * MILLISECONDS_PER_DAY;
		case 'custom':
			if (customExpiresAt && customExpiresAt > now) {
				return customExpiresAt;
			}
			// Fallback to 30 days if custom is invalid
			return now + 30 * MILLISECONDS_PER_DAY;
		default:
			return now + 30 * MILLISECONDS_PER_DAY;
	}
}

/**
 * Format expiration for display
 */
export function formatCapabilityExpiration(expiresAt: number): string {
	const now = Date.now();
	const diff = expiresAt - now;

	if (diff <= 0) {
		return 'Expired';
	}

	const hours = Math.floor(diff / MILLISECONDS_PER_HOUR);
	const days = Math.floor(diff / MILLISECONDS_PER_DAY);

	if (hours < 24) {
		return `${hours}h remaining`;
	}
	if (days < 30) {
		return `${days}d remaining`;
	}
	if (days < 365) {
		const months = Math.round(days / 30);
		return `${months}mo remaining`;
	}
	if (days > 36500) {
		return 'Permanent';
	}

	const years = Math.round(days / 365);
	return `${years}y remaining`;
}

// ============================================================================
// Nonce Generation
// ============================================================================

/**
 * Generate a cryptographically random nonce
 */
export function generateNonce(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return bytesToHex(bytes);
}

// ============================================================================
// Capability ID Generation
// ============================================================================

/**
 * Generate a unique capability ID
 */
export function generateCapabilityId(
	holonId: string,
	allowedActions: string[],
	itemId: string | undefined,
	nonce: string
): string {
	const actionPart = allowedActions.sort().join('-');
	const itemPart = itemId ? `-${itemId.replace(/\s+/g, '_').substring(0, 20)}` : '';
	return `qrcap_${holonId.substring(0, 8)}_${actionPart}${itemPart}_${nonce.substring(0, 8)}`;
}

// ============================================================================
// Signing and Verification
// ============================================================================

/**
 * Create a hash of capability fields for signing
 * Includes all fields that define the capability's scope and validity
 */
function hashCapabilityFields(cap: Omit<QRCapabilityToken, 'signature'>): Uint8Array {
	// Create a deterministic string representation of all capability fields
	const message = [
		'qr_capability',
		cap.id,
		cap.issuerPubKey,
		cap.holonId,
		cap.allowedLenses.sort().join(','),
		cap.allowedActions.sort().join(','),
		cap.itemId || '',
		cap.issuedAt.toString(),
		cap.expiresAt.toString(),
		cap.maxUses?.toString() || 'unlimited',
		cap.nonce
	].join(':');

	return sha256(new TextEncoder().encode(message));
}

/**
 * Sign a capability token with the issuer's private key
 */
export function signCapability(
	cap: Omit<QRCapabilityToken, 'signature'>,
	privateKey: string
): string {
	const messageHash = hashCapabilityFields(cap);
	const signature = schnorr.sign(messageHash, privateKey);
	return bytesToHex(signature);
}

/**
 * Verify a capability token's signature
 */
export function verifyCapabilitySignature(cap: QRCapabilityToken): boolean {
	try {
		const messageHash = hashCapabilityFields(cap);
		const signatureBytes = hexToBytes(cap.signature);
		const publicKeyBytes = hexToBytes(cap.issuerPubKey);
		return schnorr.verify(signatureBytes, messageHash, publicKeyBytes);
	} catch (error) {
		console.error('QR capability signature verification failed:', error);
		return false;
	}
}

// ============================================================================
// Capability Creation
// ============================================================================

/**
 * Create and sign a new QR capability token
 */
export function createQRCapability(options: CreateQRCapabilityOptions): QRCapabilityToken {
	// Verify the private key matches the holon ID (issuer must be holon owner)
	const derivedPubKey = bytesToHex(schnorr.getPublicKey(options.issuerPrivateKey));
	if (derivedPubKey !== options.holonId) {
		throw new Error('Private key does not match holon ID - only holon owner can create capabilities');
	}

	const nonce = generateNonce();
	const now = Date.now();
	const expiresAt = getExpirationTimestamp(options.expiration, options.customExpiresAt);

	const capabilityWithoutSig: Omit<QRCapabilityToken, 'signature'> = {
		id: generateCapabilityId(options.holonId, options.allowedActions, options.itemId, nonce),
		type: 'qr_capability',
		issuerPubKey: derivedPubKey,
		holonId: options.holonId,
		allowedLenses: options.allowedLenses,
		allowedActions: options.allowedActions,
		itemId: options.itemId,
		issuedAt: now,
		expiresAt,
		maxUses: options.maxUses ?? null,
		useCount: 0,
		nonce,
		metadata: options.metadata
	};

	const signature = signCapability(capabilityWithoutSig, options.issuerPrivateKey);

	return {
		...capabilityWithoutSig,
		signature
	};
}

// ============================================================================
// Capability Validation
// ============================================================================

/**
 * Validate a capability token for a specific action
 */
export function validateCapability(
	cap: QRCapabilityToken,
	targetHolonId: string,
	action: string,
	itemTitle?: string
): CapabilityValidationResult {
	// Check basic structure
	if (!cap || cap.type !== 'qr_capability') {
		return { valid: false, reason: 'Malformed capability token', code: 'MALFORMED' };
	}

	// Verify signature
	if (!verifyCapabilitySignature(cap)) {
		return { valid: false, reason: 'Invalid signature - capability may be tampered', code: 'INVALID_SIGNATURE' };
	}

	// Verify issuer is the holon owner
	if (cap.issuerPubKey !== cap.holonId) {
		return { valid: false, reason: 'Issuer is not the holon owner', code: 'ISSUER_NOT_OWNER' };
	}

	// Verify target holon matches
	if (cap.holonId !== targetHolonId) {
		return { valid: false, reason: 'Capability is for a different holon', code: 'ISSUER_NOT_OWNER' };
	}

	// Check expiration
	if (cap.expiresAt <= Date.now()) {
		return { valid: false, reason: 'Capability has expired', code: 'EXPIRED' };
	}

	// Check use limit
	if (cap.maxUses !== null && cap.useCount >= cap.maxUses) {
		return { valid: false, reason: 'Capability use limit exceeded', code: 'USE_LIMIT_EXCEEDED' };
	}

	// Check action is allowed
	const normalizedAction = action.toLowerCase();
	if (cap.allowedActions.length > 0 && !cap.allowedActions.includes(normalizedAction)) {
		return {
			valid: false,
			reason: `Action '${action}' is not allowed by this capability`,
			code: 'ACTION_NOT_ALLOWED'
		};
	}

	// Check lens is allowed (derive from action)
	const targetLens = ACTION_TO_LENS_MAP[normalizedAction];
	if (targetLens && cap.allowedLenses.length > 0 && !cap.allowedLenses.includes(targetLens)) {
		return {
			valid: false,
			reason: `Writing to '${targetLens}' is not allowed by this capability`,
			code: 'LENS_NOT_ALLOWED'
		};
	}

	// Check item restriction if specified
	if (cap.itemId && itemTitle && cap.itemId !== itemTitle) {
		return {
			valid: false,
			reason: `Capability is restricted to item '${cap.itemId}'`,
			code: 'ITEM_MISMATCH'
		};
	}

	return { valid: true, code: 'VALID' };
}

/**
 * Quick check if capability is valid (basic checks only, no action validation)
 */
export function isCapabilityValid(cap: QRCapabilityToken): boolean {
	if (!cap || cap.type !== 'qr_capability') return false;
	if (cap.expiresAt <= Date.now()) return false;
	if (cap.maxUses !== null && cap.useCount >= cap.maxUses) return false;
	return verifyCapabilitySignature(cap);
}

// ============================================================================
// URL Encoding/Decoding
// ============================================================================

/**
 * Encode capability token for URL embedding (base64url)
 */
export function encodeCapabilityForUrl(cap: QRCapabilityToken): string {
	const json = JSON.stringify(cap);
	// Use base64url encoding (URL-safe)
	const base64 = btoa(json);
	return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decode capability token from URL parameter
 */
export function decodeCapabilityFromUrl(encoded: string): QRCapabilityToken | null {
	try {
		// Restore base64 from base64url
		let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
		// Add padding if needed
		while (base64.length % 4) {
			base64 += '=';
		}
		const json = atob(base64);
		const cap = JSON.parse(json) as QRCapabilityToken;

		// Basic structure validation
		if (cap.type !== 'qr_capability' || !cap.signature || !cap.holonId) {
			return null;
		}

		return cap;
	} catch (error) {
		console.error('Failed to decode capability from URL:', error);
		return null;
	}
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the lens name for a given action type
 */
export function getLensForAction(action: string): string | undefined {
	return ACTION_TO_LENS_MAP[action.toLowerCase()];
}

/**
 * Create capabilities for a list of cards
 */
export function createCapabilitiesForCards(
	cards: Array<{ id: string; type: string; title: string }>,
	holonId: string,
	issuerPrivateKey: string,
	expiration: CapabilityExpiration,
	deckId?: string
): Map<string, QRCapabilityToken> {
	const capabilities = new Map<string, QRCapabilityToken>();

	for (const card of cards) {
		const lens = getLensForAction(card.type);
		if (!lens) {
			console.warn(`Unknown card type: ${card.type}, skipping capability generation`);
			continue;
		}

		const capability = createQRCapability({
			holonId,
			issuerPrivateKey,
			allowedLenses: [lens],
			allowedActions: [card.type.toLowerCase()],
			itemId: card.title,
			expiration,
			metadata: {
				deckId,
				cardId: card.id,
				cardTitle: card.title,
				cardType: card.type
			}
		});

		capabilities.set(card.id, capability);
	}

	return capabilities;
}
