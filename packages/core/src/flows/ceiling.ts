// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The ceiling a claim is judged against — one rule, every surface.
 *
 * `foldClaims` holds a claim as `over` when it would push the party past
 * their right in that unit (`RightsLookup`). The fold already subtracts the
 * party's ACCEPTED claims — approved and settled, in log order — so what it
 * needs is not what is left of a right but the right itself, less the draws
 * the log does not know about: fund payments on the expenses lens and the
 * collective's paid or open expenses. That is a CEILING, and `claimCeilings`
 * builds it from the same allocation, pot and usage the account card reads,
 * so the number a form shows and the verdict the fold reaches cannot drift.
 *
 * Fold-independent by construction: `usage.lifetime` counts the log's own
 * draws when it was built from a fold, and those are taken back out here —
 * so the ceilings come out the same whether the usage was built from a
 * capped or an uncapped fold. That is what lets a surface fold once for the
 * shape, size the pot, and fold again with the ceiling, with no cycle.
 *
 * `claimHeadroom` is the other side of the same arithmetic: what the NEXT
 * claim may be. It also subtracts the party's own claims still awaiting
 * attestation, which the fold cannot (only accepted entries change its
 * state), so two claims raised in a row cannot both pass the form and then
 * flip to `over` once the first is attested.
 *
 * Pure: shapes in, numbers out.
 */

import { normalizeCurrency } from '../expenses/index.js';
import type { AllocationResult, AllocationSlice } from './allocation.js';
import { claimTotalsOf, type FoldedClaims, type RightsLookup } from './claims.js';
import { lifetimeOf, type FundUsage } from './usage.js';

/** Party → UNIT (upper-case, as the fold keys it) → ceiling. A valid `RightsLookup`. */
export type ClaimCeilings = Record<string, Record<string, number>>;

export interface ClaimCeilingInput {
  /**
   * Who holds what share of the pot: `cascadeRights(cascade)` when there is a
   * cascade, the root `allocate(...)` otherwise. Only percentages are read, so
   * a percentage-only shape (`total: null`) serves every unit at once.
   */
  shares: AllocationResult;
  /** Unit → the pot in that unit (`potTotal`), in any case. Units with no pot have no ceiling. */
  pots: Record<string, number>;
  /** The fund's usage, for the draws the log does not record. */
  usage: FundUsage | null | undefined;
  /** The fold `usage` was built from, so the log's own draws are not subtracted twice. */
  claims: FoldedClaims | null | undefined;
  /**
   * Units the holon holds in its Pot. A right in them is COLLECTED from the
   * Pot by its rights table, never claimed in the log, so the ceiling is zero:
   * the value cannot be drawn twice.
   */
  held?: readonly string[] | null;
}

const round = (v: number) => Math.round(v * 100) / 100;
const unitKey = (u: string) => normalizeCurrency(u).toUpperCase();

/** Every party with a seat, and the share their seats add up to. */
export function partyShares(shares: AllocationResult): Map<string, number> {
  const out = new Map<string, number>();
  const add = (slice: AllocationSlice) => {
    if (!(slice.percentage > 0)) return;
    out.set(slice.id, (out.get(slice.id) ?? 0) + slice.percentage);
  };
  for (const slice of shares.interior) add(slice);
  for (const zone of shares.exterior) for (const member of zone.members ?? []) add(member);
  return out;
}

/**
 * The ceiling per party and unit: their share of the pot, less what they
 * drew OUTSIDE the claims log. May come out negative — the fold then holds
 * every new claim, which is the truth of an overrun right.
 */
export function claimCeilings(input: ClaimCeilingInput): ClaimCeilings {
  const out: ClaimCeilings = {};
  const parties = partyShares(input.shares);
  if (parties.size === 0) return out;
  // The usage only carries the log's draws when it was built from a fold.
  const logged = input.usage && input.usage.claimsSource !== 'expenses' ? input.claims : null;
  const held = new Set((input.held ?? []).map(unitKey));
  for (const [unitRaw, potRaw] of Object.entries(input.pots ?? {})) {
    const unit = normalizeCurrency(unitRaw);
    const pot = Number(potRaw);
    if (!unit || !Number.isFinite(pot) || pot <= 0) continue;
    const key = unit.toUpperCase();
    if (held.has(key)) {
      for (const party of parties.keys()) (out[party] ??= {})[key] = 0;
      continue;
    }
    for (const [party, pct] of parties) {
      const right = (pct / 100) * pot;
      const life = lifetimeOf(input.usage, party, unit);
      const log = logged ? claimTotalsOf(logged, party, key) : { claimed: 0, settled: 0, pending: 0, over: 0 };
      const outsideSpent = Math.max(0, life.spent - log.settled);
      const outsideClaimed = Math.max(0, life.claimed - log.claimed);
      (out[party] ??= {})[key] = round(right - outsideSpent - outsideClaimed);
    }
  }
  return out;
}

/** The ceiling a lookup gives for a party and unit, or null when none is known. */
export function ceilingOf(ceilings: RightsLookup | null | undefined, party: string, unit: string): number | null {
  if (!ceilings) return null;
  const key = unitKey(unit);
  const v = typeof ceilings === 'function' ? ceilings(String(party), key) : ceilings[String(party)]?.[key];
  return v == null || !Number.isFinite(Number(v)) ? null : Number(v);
}

/**
 * What `party` may still claim in `unit`: the ceiling less what the log
 * already holds for them — approved, settled, and still awaiting a verdict.
 * Floored at zero; null when no ceiling is known for that unit.
 */
export function claimHeadroom(
  ceilings: RightsLookup | null | undefined,
  claims: FoldedClaims | null | undefined,
  party: string,
  unit: string,
): number | null {
  const ceiling = ceilingOf(ceilings, party, unit);
  if (ceiling == null) return null;
  const t = claimTotalsOf(claims, String(party), unitKey(unit));
  return Math.max(0, round(ceiling - t.claimed - t.settled - t.pending));
}

/** Whether `amount` fits under the headroom, with the fold's own tolerance. */
export function fitsHeadroom(headroom: number | null | undefined, amount: number): boolean {
  if (headroom == null) return true;
  return Number(amount) <= headroom + 0.005;
}
