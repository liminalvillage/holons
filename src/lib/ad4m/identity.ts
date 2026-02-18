/**
 * Identity Abstraction Helper
 *
 * Provides mode-aware identity resolution for display purposes.
 * In holosphere mode, returns nostr pubkey/npub.
 * In ad4m mode, returns the agent DID.
 *
 * Only for display/formatting — does NOT touch crypto/signing paths.
 *
 * @module ad4m/identity
 */

import { get } from 'svelte/store';
import { ad4mConfig } from './config';

/** Identity format returned by getIdentity() */
export interface Identity {
  publicKey: string;
  displayId: string;
  format: 'npub' | 'did';
}

// Cache for the AD4M agent DID (set externally when connection is established)
let _cachedAgentDid: string | null = null;

/**
 * Set the cached agent DID (called by connect-ui or adapter on connection).
 */
export function setAgentDid(did: string): void {
  _cachedAgentDid = did;
}

/**
 * Get the cached agent DID.
 */
export function getAgentDid(): string | null {
  return _cachedAgentDid;
}

/**
 * Returns the current user's identity in the appropriate format.
 *
 * Requires either:
 * - holosphere mode: nostr pubkey available in the store/context
 * - ad4m mode: agent DID cached via setAgentDid()
 *
 * @param nostrPubKey - The nostr public key (hex), if available
 * @param hexToNpubFn - Function to convert hex to npub (from holosphere nostrUtils)
 */
export function getIdentity(
  nostrPubKey?: string | null,
  hexToNpubFn?: (hex: string) => string
): Identity {
  const config = get(ad4mConfig);

  if (config.mode === 'ad4m' && _cachedAgentDid) {
    return {
      publicKey: _cachedAgentDid,
      displayId: formatIdentity(_cachedAgentDid),
      format: 'did',
    };
  }

  // Default: holosphere/dual mode — use nostr pubkey
  const pubKey = nostrPubKey || '';
  const npub = pubKey && hexToNpubFn ? hexToNpubFn(pubKey) : pubKey;

  return {
    publicKey: pubKey,
    displayId: npub ? formatIdentity(npub) : '',
    format: 'npub',
  };
}

/**
 * Formats an identity string for display (shortened).
 *
 * Handles both npub (bech32) and DID formats:
 * - npub1abc...xyz → npub1abc...xyz (first 12 + last 6)
 * - did:key:z6Mk... → did:key:z6Mk...xxxx (first 16 + last 6)
 * - hex pubkey → first 8 + last 6
 */
export function formatIdentity(id: string): string {
  if (!id) return '';

  if (id.startsWith('did:')) {
    if (id.length <= 24) return id;
    return `${id.slice(0, 16)}...${id.slice(-6)}`;
  }

  if (id.startsWith('npub')) {
    if (id.length <= 20) return id;
    return `${id.slice(0, 12)}...${id.slice(-6)}`;
  }

  // Hex key
  if (id.length <= 16) return id;
  return `${id.slice(0, 8)}...${id.slice(-6)}`;
}
