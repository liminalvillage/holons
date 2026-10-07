// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Reading the ceilings off the store — for the surfaces that have no board
 * already holding the cascade, the pot and the usage in memory (the MCP, the
 * bot). The kiosk and the web build the same `claimCeilings` from what they
 * already derived; this loader walks the same lenses the boards do, so a
 * claim is judged the same wherever it was raised.
 *
 * Bounded like every other walk here: the cascade reads `maxHolons` splits
 * at most, the inbound climb its own budget. A cascade cut short only makes
 * the ceilings MORE permissive (a leaf that was not followed keeps its whole
 * seat), never stricter — a quiet relay cannot hold someone's claim.
 */

import type { Expense } from '../expenses/index.js';
import { normalizeCurrency } from '../expenses/index.js';
import type { AllocationMember, AllocationResult } from './allocation.js';
import { loadBundleRecord, loadPotRecord, readBundleTokens } from './bundle.js';
import { childResolver, loadAllocationInputs, loadCascadeChildren } from './cascade-load.js';
import { DEFAULT_CASCADE_DEPTH, cascadeRights, resolveCascade } from './cascade.js';
import { claimCeilings, partyShares, type ClaimCeilings } from './ceiling.js';
import type { FoldedClaims } from './claims.js';
import { nativeUnit } from './holdings.js';
import { loadInboundRights } from './inbound.js';
import { loadMints } from './mints-load.js';
import type { OpenCollectiveSnapshot } from './opencollective.js';
import { potTotal, potUnits, type PotSources } from './pot.js';
import { buildFundUsage, type FundUsage, type FundUsageParty } from './usage.js';

export const DEFAULT_CEILING_HOLONS = 20;

export interface LoadClaimCeilingsOptions {
  /** The fold the surface already has (uncapped is fine): the log's own draws are read off it. */
  claims: FoldedClaims | null | undefined;
  /** The scored roster of an equation-mode holon. Absent: no contributor seats resolve. */
  scoreOf?: (holonId: string) => Promise<AllocationMember[]>;
  /** Cascade bounds. */
  maxHolons?: number;
  maxDepth?: number;
  /** The collective's snapshot, when the surface fetched one; apps own that fetch. */
  collective?: OpenCollectiveSnapshot | null;
  /** The holon's expenses; default reads the lens. */
  expenses?: Expense[] | null;
  /** Everyone in the holon, for an expense with no split; default the rights-holders. */
  members?: readonly string[];
  /** Unit → what the holon's Pot received in it, when the surface read the chain; apps own that read. */
  chain?: Record<string, number> | null;
  now?: number;
}

export interface LoadedClaimCeilings {
  ceilings: ClaimCeilings;
  /** Who holds what share of the pot, net of what they pass on. */
  shares: AllocationResult;
  /** Unit → pot. */
  pots: Record<string, number>;
  usage: FundUsage | null;
  /** The cascade or the inbound climb hit a bound. */
  truncated: boolean;
  /** Units held in the holon's Pot: collected by its table, ceiling zero in the log. */
  held: string[];
}

const EMPTY: LoadedClaimCeilings = {
  ceilings: {},
  shares: { config: { interiorPercent: 0, steepness: 0, nzones: 0 }, unit: '', total: null, interior: [], exterior: [] },
  pots: {},
  usage: null,
  truncated: false,
  held: [],
};

/** The ceilings every party holds over `holonId`'s fund, per unit, read from the store. */
export async function loadClaimCeilings(
  holosphere: any,
  holonId: string,
  opts: LoadClaimCeilingsOptions,
): Promise<LoadedClaimCeilings> {
  const holon = String(holonId ?? '');
  if (!holosphere || !holon) return EMPTY;
  const quiet = <T>(p: Promise<T>, fallback: T): Promise<T> => p.then((v) => v ?? fallback).catch(() => fallback);

  const inputs = await loadAllocationInputs(holosphere, holon, { scoreOf: opts.scoreOf });
  if (!inputs.configured) return EMPTY;
  const root = { config: inputs.config, members: inputs.members, zoned: inputs.zoned };
  const rootPartyIds = [...new Set([...inputs.members.map((m) => m.id), ...inputs.zoned.filter((p) => p.zone >= 1).map((p) => p.id)])];

  const [loaded, mints, inbound, expenses, pot, bundle] = await Promise.all([
    loadCascadeChildren(holosphere, rootPartyIds, {
      rootId: holon,
      maxDepth: opts.maxDepth,
      maxHolons: opts.maxHolons ?? DEFAULT_CEILING_HOLONS,
      scoreOf: opts.scoreOf,
    }),
    quiet(loadMints(holosphere, holon).then((c) => c.folded), null),
    quiet(loadInboundRights(holosphere, holon, { scoreOf: opts.scoreOf }), { inbound: [], upstreams: [], visited: 0, truncated: false }),
    opts.expenses !== undefined ? Promise.resolve(opts.expenses ?? []) : quiet<Expense[]>(holosphere.getAll(holon, 'expenses'), []),
    quiet(loadPotRecord(holosphere, holon), null),
    quiet(loadBundleRecord(holosphere, holon), null),
  ]);
  // The units the holon reads on-chain are the ones its Pot holds.
  const held = pot ? [...new Set([nativeUnit(pot.chainId), ...readBundleTokens(bundle).map((t) => t.symbol)].map((u) => normalizeCurrency(u)))] : [];

  const cascade = resolveCascade({
    holonId: holon,
    total: null,
    root,
    resolveChild: childResolver(loaded.children),
    maxDepth: opts.maxDepth ?? DEFAULT_CASCADE_DEPTH,
  });
  const shares = cascadeRights(cascade);

  const sources: PotSources = {
    collective: opts.collective ? { currency: opts.collective.currency, balance: opts.collective.balance } : null,
    mints,
    inbound: inbound.inbound,
    chain: opts.chain ?? null,
  };
  const units = potUnits(sources);
  if (units.length === 0) return { ...EMPTY, shares, truncated: loaded.truncated || inbound.truncated, held };

  const parties: FundUsageParty[] = [...partyShares(shares).keys()].map((id) => ({ id, name: id }));
  const usage = buildFundUsage({
    holonId: holon,
    unit: units[0],
    parties,
    members: opts.members,
    expenses: (expenses ?? []) as Expense[],
    collective: opts.collective ?? null,
    claims: opts.claims ?? null,
    ...(opts.now != null ? { now: opts.now } : {}),
  });
  const pots: Record<string, number> = {};
  for (const unit of units) {
    const total = potTotal(unit, sources, usage);
    if (total > 0) pots[normalizeCurrency(unit)] = total;
  }

  return {
    ceilings: claimCeilings({ shares, pots, usage, claims: opts.claims ?? null, held }),
    shares,
    pots,
    usage,
    truncated: loaded.truncated || inbound.truncated || cascade.truncated,
    held,
  };
}
