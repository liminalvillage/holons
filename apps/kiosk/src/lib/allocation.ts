// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// The shape the allocation sheet hands back while it is being edited.
//
// It lives outside the component because two of them speak it: the sheet
// dispatches a draft on every change, and the Flows board draws its Sankey
// from that draft instead of from the saved settings, so the diagram answers
// a slider immediately. Nothing here is persisted — `saveAllocationConfig`
// takes these same four pieces when Save is pressed.

import type { AllocationConfig, InteriorShares } from "@holons/core/flows";

export interface AllocationDraft {
  config: AllocationConfig;
  /** Federation partner id → ring. */
  zones: Record<string, number>;
  /** Person (user id) → ring. */
  people: Record<string, number>;
  /** The hand-set contributors' split, read under `interiorMode: custom`. */
  shares: InteriorShares;
}
