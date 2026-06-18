// SPDX-License-Identifier: AGPL-3.0-or-later
//
// HNS (Holon Name Service) — read-only lookup for the kiosk.
//
// Holon names are published to a GLOBAL, publicly-readable table — no
// federation needed to read it — and each entry is signed by the holon's own
// key (its id IS the schnorr public key), so a name can't be spoofed. The
// kiosk only ever READS names (registration lives in the dashboard), so this
// is just the verify-and-return half of apps/web's `lib/hns`.

import { schnorr } from "@noble/curves/secp256k1";
import { hexToBytes } from "@noble/hashes/utils";
import { sha256 } from "@noble/hashes/sha256";
import type { HoloSphere } from "holosphere";

const HNS_LENS = "hns";

interface HNSEntry {
  holonId: string;
  name: string;
  timestamp: number;
  signature: string;
}

// The signed message is `hns:<holonId>:<name>:<timestamp>`; the signature must
// verify against the holon id as the x-only public key.
function verifyEntry(entry: HNSEntry): boolean {
  try {
    const msg = `hns:${entry.holonId}:${entry.name}:${entry.timestamp}`;
    const hash = sha256(new TextEncoder().encode(msg));
    return schnorr.verify(
      hexToBytes(entry.signature),
      hash,
      hexToBytes(entry.holonId),
    );
  } catch {
    return false; // malformed hex / non-pubkey id → treat as unverified
  }
}

/**
 * Resolve a holon's signed display name from the global HNS table. Returns the
 * name only when its signature verifies against the holon id; otherwise null.
 * Read-only, federation-free, and best-effort (never throws).
 */
export async function lookupHolonName(
  hs: HoloSphere,
  holonId: string,
): Promise<string | null> {
  try {
    const entry = (await hs.getGlobal(HNS_LENS, holonId)) as HNSEntry | null;
    if (!entry || !entry.name) return null;
    return verifyEntry(entry) ? entry.name : null;
  } catch {
    return null;
  }
}
