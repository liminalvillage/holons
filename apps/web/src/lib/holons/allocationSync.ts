// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pushing an allocation split to the chain, in one place.
 *
 * Two surfaces edit the same split: Flow Management (the concentric editor at
 * /[id]/flow) and the Allocation panel on /[id]/flows. A split that reached the
 * contract from one of them but not the settings lens — or the other way round
 * — would make the wallet-less readers (the kiosk board, this dashboard's
 * Flows view) disagree with the contract, so the two writes belong together in
 * one function rather than being repeated per caller.
 *
 * The contract half needs a wallet; the mirror half does not. `syncAllocation`
 * does both; `mirrorAllocation` does the off-chain half alone, which is what a
 * caretaker with no wallet can still legitimately save.
 */

import type { ethers } from "ethers";
import type { HoloSphere } from "holosphere";
import type { HolonsManager } from "./HolonsManager";
import { readBundleRecord, saveAllocationConfig } from "@holons/core/flows";
import type { HolonBundleRecord } from "@holons/core/flows";

/** The split as the UI holds it: percentages and a count, no WAD anywhere. */
export interface AllocationDraft {
  /** 0-100; the exterior gets the rest. */
  interiorPercent: number;
  /** 0-100 UI scale. Higher is a flatter spread across zones. */
  steepness: number;
  nzones: number;
}

/** An interior member's share, as the contribution scoring yields it. */
export interface SyncMember {
  userId: string;
  /** 0-100. Re-normalized to basis points by the contract call. */
  percentage: number;
}

/** A federated partner's ring. Zone < 1 means unplaced. */
export interface SyncPartner {
  id: string;
  zone: number;
}

/** Convert steepness from UI value (0-100) to contract value (BigInt). */
export function steepnessToContract(uiValue: number): bigint {
  // Contract expects 0 < s < 1e18 (WAD scale, strictly between)
  // Clamp to valid range: 1 to 999999999999999999 (just under 1e18)
  const minValue = 1n;
  const maxValue = BigInt(1e18) - 1n;
  const scaled = BigInt(Math.floor((uiValue / 100) * 1e18));
  if (scaled <= 0n) return minValue;
  if (scaled >= BigInt(1e18)) return maxValue;
  return scaled;
}

/** Convert steepness from contract value (BigInt) to UI value (0-100). */
export function steepnessFromContract(contractValue: bigint): number {
  return Number((contractValue * 100n) / BigInt(1e18));
}

/** Zone assignments as the settings mirror stores them, unplaced included. */
function zoneMap(partners: SyncPartner[]): Record<string, number> {
  const zones: Record<string, number> = {};
  for (const partner of partners ?? []) zones[partner.id] = partner.zone;
  return zones;
}

/**
 * Save the split off-chain only.
 *
 * This is the record every wallet-less surface reads, so it is a real save and
 * not a draft: the kiosk board and the Flows view will show it immediately.
 */
export async function mirrorAllocation(
  holosphere: HoloSphere,
  holonId: string,
  draft: AllocationDraft,
  partners: SyncPartner[] = [],
): Promise<void> {
  await saveAllocationConfig(holosphere, holonId, draft, zoneMap(partners));
}

/**
 * Push the split to the Bundle contract, then mirror it off-chain.
 *
 * The mirror runs after the transaction is submitted, so what wallet-less
 * surfaces read is what was actually sent. Unplaced partners (`zone < 1`) are
 * mirrored but not sent: the contract only knows about placed ones, while the
 * settings lens has to remember that somebody deliberately left one out.
 */
export async function syncAllocation(params: {
  manager: HolonsManager;
  holosphere: HoloSphere | null;
  holonId: string;
  bundleAddress: string;
  draft: AllocationDraft;
  members: SyncMember[];
  partners: SyncPartner[];
}): Promise<ethers.TransactionResponse> {
  const {
    manager,
    holosphere,
    holonId,
    bundleAddress,
    draft,
    members,
    partners,
  } = params;

  const tx = await manager.syncAll(bundleAddress, {
    interiorPercent: draft.interiorPercent,
    steepness: steepnessToContract(draft.steepness),
    nzones: draft.nzones,
    interiorMembers: members.map((m) => ({
      userId: String(m.userId),
      percentage: m.percentage,
    })),
    exteriorMembers: partners
      .filter((p) => p.zone >= 1)
      .map((p) => ({ userId: String(p.id), zone: p.zone })),
  });

  if (holosphere) {
    await mirrorAllocation(holosphere, holonId, draft, partners);
  }

  return tx;
}

/**
 * The deployed bundle for a holon, read from the canonical settings document.
 *
 * A single keyed lookup — the record lives at `settings/<holonId>`, not under a
 * random key — so this needs no wallet and no contract call.
 */
export async function loadBundleRecord(
  holosphere: HoloSphere | null,
  holonId: string,
): Promise<HolonBundleRecord | null> {
  if (!holosphere || !holonId) return null;
  try {
    const settings = await holosphere.get(
      String(holonId),
      "settings",
      String(holonId),
    );
    return readBundleRecord(settings);
  } catch {
    // No settings document yet, or the relay is quiet: no bundle to report.
    return null;
  }
}
