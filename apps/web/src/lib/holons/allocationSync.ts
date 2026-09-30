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
import {
  chainInteriorRoster,
  resolveInteriorMembers,
  saveAllocationConfig,
  steepnessFromContract,
  steepnessToContract,
} from "@holons/core/flows";
import type { InteriorMode, InteriorShares } from "@holons/core/flows";

/** The split as the UI holds it: percentages and a count, no WAD anywhere. */
export interface AllocationDraft {
  /** 0-100; the exterior gets the rest. */
  interiorPercent: number;
  /** 0-100 UI scale. Higher is a flatter spread across zones. */
  steepness: number;
  nzones: number;
  /** How the contributors' share is divided; absent means by the equation. */
  interiorMode?: InteriorMode;
}

/** An interior member's share, as the contribution scoring yields it. */
export interface SyncMember {
  userId: string;
  /** 0-100. Re-normalized to basis points by the contract call. */
  percentage: number;
}

/**
 * The interior roster the contract is sent: the scored members under the
 * equation, the custom shares under `custom` — one resolver, shared with every
 * wallet-less reader through core, so the chain pays exactly what the mirror
 * shows.
 */
export function membersForSync(
  draft: Pick<AllocationDraft, "interiorMode">,
  scored: SyncMember[],
  shares?: InteriorShares,
): SyncMember[] {
  return resolveInteriorMembers({
    config: { interiorMode: draft.interiorMode },
    scored: scored.map((m) => ({
      id: String(m.userId),
      name: String(m.userId),
      percentage: m.percentage,
    })),
    shares,
  }).map((m) => ({ userId: m.id, percentage: m.percentage }));
}

/** A federated partner's ring. Zone < 1 means unplaced. */
export interface SyncPartner {
  id: string;
  zone: number;
}

// The steepness scale lives in core now (flows/contract.ts) so the kiosk's
// wallet call and this manager agree; re-exported for the callers here.
export { steepnessFromContract, steepnessToContract };

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
  shares?: InteriorShares,
): Promise<void> {
  await saveAllocationConfig(
    holosphere,
    holonId,
    draft,
    zoneMap(partners),
    undefined,
    shares,
  );
}

/**
 * Push the split to the Bundle contract, then mirror it off-chain.
 *
 * The mirror runs after the transaction is submitted, so what wallet-less
 * surfaces read is what was actually sent. Unplaced partners (`zone < 1`) are
 * mirrored but not sent: the contract only knows about placed ones, while the
 * settings lens has to remember that somebody deliberately left one out.
 *
 * `members` are the SCORED shares; under a custom split the contract is sent
 * the `shares` instead, resolved by the same rule the mirror is read with.
 * The shares are mirrored either way, so a later flip back to custom finds
 * them again.
 */
export async function syncAllocation(params: {
  manager: HolonsManager;
  holosphere: HoloSphere | null;
  holonId: string;
  bundleAddress: string;
  draft: AllocationDraft;
  members: SyncMember[];
  partners: SyncPartner[];
  shares?: InteriorShares;
}): Promise<ethers.TransactionResponse> {
  const {
    manager,
    holosphere,
    holonId,
    bundleAddress,
    draft,
    members,
    partners,
    shares,
  } = params;

  const tx = await manager.syncAll(bundleAddress, {
    interiorPercent: draft.interiorPercent,
    steepness: steepnessToContract(draft.steepness),
    nzones: draft.nzones,
    // An interior share with nobody in it seats the holon itself: the Bundle
    // has no withdraw, so a pot paid to no one would be stranded.
    interiorMembers: chainInteriorRoster(
      holonId,
      membersForSync(draft, members, shares),
      draft.interiorPercent,
    ).map((m) => ({
      userId: String(m.userId),
      percentage: m.percentage,
    })),
    exteriorMembers: partners
      .filter((p) => p.zone >= 1)
      .map((p) => ({ userId: String(p.id), zone: p.zone })),
  });

  if (holosphere) {
    await mirrorAllocation(holosphere, holonId, draft, partners, shares);
  }

  return tx;
}
