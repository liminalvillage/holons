/**
 * HNS - Holon Name Service
 *
 * A decentralized name registry for holons using cryptographic signatures
 * to ensure only holon owners can register/update their names.
 *
 * Uses the service key's holon as the public registry that anyone can read.
 */

import { schnorr } from '@noble/curves/secp256k1';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { sha256 } from '@noble/hashes/sha256';
import type { HoloSphere } from 'holosphere';

// Registry lens name
const HNS_LENS = 'hns';

// Cache for verified names
const hnsCache = new Map<string, HNSEntry>();
const fetchPromises = new Map<string, Promise<HNSEntry | null>>();

export interface HNSEntry {
  holonId: string;
  name: string;
  timestamp: number;
  signature: string;
}

/**
 * Get the registry holon ID (derived from service key)
 */
export function getRegistryHolonId(): string | null {
  const servicePrivateKey = import.meta.env.VITE_HOLOSPHERE_PRIVATE_KEY;
  if (!servicePrivateKey) return null;

  try {
    const pubKeyBytes = schnorr.getPublicKey(servicePrivateKey);
    return bytesToHex(pubKeyBytes);
  } catch {
    return null;
  }
}

/**
 * Create a hash of the entry data for signing
 */
function hashEntry(holonId: string, name: string, timestamp: number): Uint8Array {
  const message = `hns:${holonId}:${name}:${timestamp}`;
  return sha256(new TextEncoder().encode(message));
}

/**
 * Sign an HNS entry with the holon owner's private key
 */
export function signEntry(
  holonId: string,
  name: string,
  timestamp: number,
  privateKey: string
): string {
  const messageHash = hashEntry(holonId, name, timestamp);
  const signature = schnorr.sign(messageHash, privateKey);
  return bytesToHex(signature);
}

/**
 * Verify an HNS entry's signature matches the holon ID (public key)
 */
export function verifyEntry(entry: HNSEntry): boolean {
  try {
    const messageHash = hashEntry(entry.holonId, entry.name, entry.timestamp);
    const signatureBytes = hexToBytes(entry.signature);
    const publicKeyBytes = hexToBytes(entry.holonId);
    return schnorr.verify(signatureBytes, messageHash, publicKeyBytes);
  } catch (error) {
    console.error('HNS signature verification failed:', error);
    return false;
  }
}

/**
 * Register or update a holon name in HNS
 */
export async function registerName(
  holosphere: HoloSphere,
  holonId: string,
  name: string,
  privateKey: string
): Promise<boolean> {
  const registryId = getRegistryHolonId();
  if (!registryId) {
    console.error('HNS: Registry holon ID not available');
    return false;
  }

  try {
    // Verify the private key matches the holon ID
    const derivedPubKey = bytesToHex(schnorr.getPublicKey(privateKey));
    if (derivedPubKey !== holonId) {
      console.error('HNS: Private key does not match holon ID');
      return false;
    }

    const timestamp = Date.now();
    const signature = signEntry(holonId, name, timestamp, privateKey);

    const entry: HNSEntry = {
      holonId,
      name,
      timestamp,
      signature
    };

    // Write to the registry holon's HNS lens
    // Use holonId as the key so each holon has one entry
    await holosphere.put(registryId, HNS_LENS, entry);

    // Update local cache
    hnsCache.set(holonId, entry);

    console.log(`HNS: Registered name "${name}" for holon ${holonId.slice(0, 8)}...`);
    return true;
  } catch (error) {
    console.error('HNS: Failed to register name:', error);
    return false;
  }
}

/**
 * Lookup a holon name from HNS
 */
export async function lookupName(
  holosphere: HoloSphere,
  holonId: string
): Promise<string | null> {
  // Check cache first
  const cached = hnsCache.get(holonId);
  if (cached) {
    return cached.name;
  }

  // Check if already fetching
  if (fetchPromises.has(holonId)) {
    const entry = await fetchPromises.get(holonId);
    return entry?.name || null;
  }

  const registryId = getRegistryHolonId();
  if (!registryId) {
    return null;
  }

  // Create fetch promise
  const fetchPromise = (async (): Promise<HNSEntry | null> => {
    try {
      // Read from the registry holon's HNS lens
      const entries = await holosphere.getAll(registryId, HNS_LENS);

      if (!entries || !Array.isArray(entries)) {
        return null;
      }

      // Find entry for this holon
      const entry = entries.find((e: any) => e?.holonId === holonId) as HNSEntry | undefined;

      if (!entry) {
        return null;
      }

      // Verify the signature
      if (!verifyEntry(entry)) {
        console.warn(`HNS: Invalid signature for holon ${holonId.slice(0, 8)}...`);
        return null;
      }

      // Cache the verified entry
      hnsCache.set(holonId, entry);
      return entry;
    } catch (error) {
      console.error('HNS: Lookup failed:', error);
      return null;
    } finally {
      fetchPromises.delete(holonId);
    }
  })();

  fetchPromises.set(holonId, fetchPromise);
  const entry = await fetchPromise;
  return entry?.name || null;
}

/**
 * Batch lookup multiple holon names
 */
export async function lookupNames(
  holosphere: HoloSphere,
  holonIds: string[]
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  const registryId = getRegistryHolonId();

  if (!registryId) {
    return results;
  }

  try {
    // Read all entries from registry
    const entries = await holosphere.getAll(registryId, HNS_LENS);

    if (!entries || !Array.isArray(entries)) {
      return results;
    }

    // Filter and verify entries for requested holons
    for (const holonId of holonIds) {
      // Check cache first
      const cached = hnsCache.get(holonId);
      if (cached) {
        results.set(holonId, cached.name);
        continue;
      }

      const entry = entries.find((e: any) => e?.holonId === holonId) as HNSEntry | undefined;

      if (entry && verifyEntry(entry)) {
        hnsCache.set(holonId, entry);
        results.set(holonId, entry.name);
      }
    }
  } catch (error) {
    console.error('HNS: Batch lookup failed:', error);
  }

  return results;
}

/**
 * Clear HNS cache
 */
export function clearHNSCache(holonId?: string): void {
  if (holonId) {
    hnsCache.delete(holonId);
    fetchPromises.delete(holonId);
  } else {
    hnsCache.clear();
    fetchPromises.clear();
  }
}

/**
 * Get all cached HNS entries
 */
export function getCachedEntries(): Map<string, HNSEntry> {
  return new Map(hnsCache);
}
