// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Saving the allocation split: the settings lens, which every surface — and
 * the Pot's rights table — reads. The split lives in one place; nothing is
 * pushed on chain any more (the Bundle rail retired with the treasury).
 */

import type { HoloSphere } from "holosphere";
import {
  resolveInteriorMembers,
  saveAllocationConfig,
} from "@holons/core/flows";
import type { InteriorMode, InteriorShares } from "@holons/core/flows";

/** The split as the UI holds it: percentages and a count. */
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
  /** 0-100. */
  percentage: number;
}

/**
 * The interior roster as resolved: the scored members under the equation,
 * the custom shares under `custom` — one resolver, shared with every reader
 * through core.
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

/** Zone assignments as the settings mirror stores them, unplaced included. */
function zoneMap(partners: SyncPartner[]): Record<string, number> {
  const zones: Record<string, number> = {};
  for (const partner of partners ?? []) zones[partner.id] = partner.zone;
  return zones;
}

/** Save the split: the record every surface reads, so a real save and not a draft. */
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
