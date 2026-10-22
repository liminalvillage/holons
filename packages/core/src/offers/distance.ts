// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a match costs across holons and scales.
 *
 * A partnership is the cheapest road: a direct partner costs one hop, a
 * partner's partner two (`federationCost`). Holons with no chain between
 * them can still meet on the map — then the cost is how far apart their
 * home cells sit on the hex grid, plus a penalty for crossing outside the
 * federation, so a stranger next door never beats a partner. Unknown
 * whereabouts on either side forbids the leg.
 */

import {
  cellToLatLng,
  cellToParent,
  getResolution,
  greatCircleDistance,
  gridDistance,
  isValidCell,
} from 'h3-js';
import { federationCost, type PartnerGraph, type TransportCost } from '../inventory/transport.js';

export interface MatchCostInput {
  /** Who is federated with whom, for `federationCost`. */
  partners: PartnerGraph;
  /** Each holon's home cell (settings.hex), when known. */
  hexOf: Record<string, string | undefined>;
  /** Added to every leg that is not a partnership. Default 1. */
  scalePenalty?: number;
  /** Cell-to-cell distance; the h3 grid by default. Inject in tests. */
  hexDistance?: (a: string, b: string) => number;
}

/**
 * Grid steps between two cells at the coarser of their resolutions, or when
 * h3 cannot walk the grid between them (pentagon seams, different base
 * cells), the great-circle distance in kilometres — coarser, always finite.
 */
export function defaultHexDistance(a: string, b: string): number {
  if (!isValidCell(a) || !isValidCell(b)) return Infinity;
  const res = Math.min(getResolution(a), getResolution(b));
  const ca = getResolution(a) === res ? a : cellToParent(a, res);
  const cb = getResolution(b) === res ? b : cellToParent(b, res);
  if (ca === cb) return 0;
  try {
    const d = gridDistance(ca, cb);
    if (Number.isFinite(d) && d >= 0) return d;
  } catch {
    /* fall through to the great circle */
  }
  const [la, lna] = cellToLatLng(ca);
  const [lb, lnb] = cellToLatLng(cb);
  return greatCircleDistance([la, lna], [lb, lnb], 'km');
}

export function matchCost(input: MatchCostInput): TransportCost {
  const byFederation = federationCost(input.partners ?? {});
  const penalty =
    typeof input.scalePenalty === 'number' && input.scalePenalty >= 0 ? input.scalePenalty : 1;
  const hexDistance = input.hexDistance ?? defaultHexDistance;
  const memo = new Map<string, number>();
  return (from, to) => {
    if (from === to) return 0;
    const hops = byFederation(from, to);
    if (Number.isFinite(hops)) return hops;
    const key = `${from} ${to}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    const a = input.hexOf?.[from];
    const b = input.hexOf?.[to];
    let cost = Infinity;
    if (a && b) {
      const d = hexDistance(a, b);
      if (Number.isFinite(d) && d >= 0) cost = penalty + d;
    }
    memo.set(key, cost);
    return cost;
  };
}
