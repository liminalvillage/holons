/**
 * HNS - Holon Name Service
 *
 * A decentralized name registry for holons using cryptographic signatures
 * to ensure only holon owners can register/update their names.
 *
 * Uses a global table for public accessibility (no federation required to read).
 */

import { npubToHex } from "@holons/core/nostr";
import { schnorr } from "@noble/curves/secp256k1";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { sha256 } from "@noble/hashes/sha256";
import type { HoloSphere } from "holosphere";

// Registry lens name
const HNS_LENS = "hns";

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
 * The registry holon id: the service key's PUBLIC key (VITE_HOLOSPHERE_NPUB,
 * `npub1…` or hex). Only the public half ever reaches the browser; the
 * matching HOLOSPHERE_NSEC stays server-side with the bot.
 */
export function getRegistryHolonId(): string | null {
  const serviceNpub = import.meta.env.VITE_HOLOSPHERE_NPUB;
  if (!serviceNpub) return null;

  try {
    return npubToHex(serviceNpub);
  } catch {
    return null;
  }
}

/**
 * Create a hash of the entry data for signing
 */
function hashEntry(
  holonId: string,
  name: string,
  timestamp: number,
): Uint8Array {
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
  privateKey: string,
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
    console.error("HNS signature verification failed:", error);
    return false;
  }
}

/**
 * Register or update a holon name in HNS
 * Uses global table for public accessibility
 */
export async function registerName(
  holosphere: HoloSphere,
  holonId: string,
  name: string,
  privateKey: string,
): Promise<boolean> {
  try {
    // Validate name before registration
    const RESERVED_NAMES = new Set([
      "no",
      "yes",
      "true",
      "false",
      "null",
      "undefined",
      "none",
      "n/a",
      "na",
      "nil",
    ]);
    if (!name || typeof name !== "string") {
      console.warn("HNS: Invalid name type, skipping registration");
      return false;
    }
    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      console.warn("HNS: Name too short, skipping registration:", trimmedName);
      return false;
    }
    if (RESERVED_NAMES.has(trimmedName.toLowerCase())) {
      console.warn(
        "HNS: Reserved word as name, skipping registration:",
        trimmedName,
      );
      return false;
    }

    // Verify the private key matches the holon ID
    const derivedPubKey = bytesToHex(schnorr.getPublicKey(privateKey));
    if (derivedPubKey !== holonId) {
      console.error("HNS: Private key does not match holon ID");
      return false;
    }

    const timestamp = Date.now();
    const signature = signEntry(holonId, trimmedName, timestamp, privateKey);

    const entry: HNSEntry & { id: string } = {
      id: holonId, // Required for global table keying
      holonId,
      name: trimmedName,
      timestamp,
      signature,
    };

    // Write to global HNS table (publicly readable, no federation needed)
    await holosphere.writeGlobal(HNS_LENS, entry);

    // Update local cache
    hnsCache.set(holonId, entry);

    console.log(
      `HNS: Registered name "${trimmedName}" for holon ${holonId.slice(0, 8)}...`,
    );
    return true;
  } catch (error) {
    console.error("HNS: Failed to register name:", error);
    return false;
  }
}

/**
 * Lookup a holon name from HNS
 * Reads from global table (publicly accessible)
 */
export async function lookupName(
  holosphere: HoloSphere,
  holonId: string,
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

  // Create fetch promise
  const fetchPromise = (async (): Promise<HNSEntry | null> => {
    try {
      // Read from global HNS table (no federation needed)
      const entry = await holosphere.getGlobal(HNS_LENS, holonId);

      if (!entry || !entry.name) {
        return null;
      }

      // Verify the signature
      if (!verifyEntry(entry)) {
        console.warn(
          `HNS: Invalid signature for holon ${holonId.slice(0, 8)}...`,
        );
        return null;
      }

      // Cache the verified entry
      hnsCache.set(holonId, entry);
      return entry;
    } catch (error) {
      // Silent fail - HNS lookup is optional
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
 * Uses global table for public accessibility
 */
export async function lookupNames(
  holosphere: HoloSphere,
  holonIds: string[],
): Promise<Map<string, string>> {
  const results = new Map<string, string>();

  try {
    // Read all entries from global HNS table
    const entries = await holosphere.getAllGlobal(HNS_LENS);

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

      const entry = entries.find((e: any) => e?.holonId === holonId) as
        | HNSEntry
        | undefined;

      if (entry && verifyEntry(entry)) {
        hnsCache.set(holonId, entry);
        results.set(holonId, entry.name);
      }
    }
  } catch (error) {
    // Silent fail - batch lookup is optional
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
