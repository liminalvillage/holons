// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cutting the lunation's rights table off the store — what a signer builds
 * at the new moon, and what a reviewer rebuilds during the challenge window
 * to compare roots.
 *
 * Walks the same lenses the boards do (`loadAllocationInputs`,
 * `loadCascadeChildren`, `resolveCascade`) so the leaves are the ones every
 * surface draws, then `advanceRights` adds this lunation's income to the
 * previous table by those leaves, paying each party at the address
 * `loadPayoutAddresses` finds for them.
 *
 * Unlike a ceiling, a table is NEVER cut from a cascade that was cut short:
 * a leaf the walk did not follow would keep its whole seat, and a root is a
 * promise the Pot pays on. `complete` says whether the walk saw everything
 * it was pointed at; the signer refuses to sign otherwise and the income
 * rolls into the next moon. What this cannot see: a settings document that
 * has not arrived looks like a holon with no split. That is what the window
 * is for.
 */

import type { AllocationMember } from './allocation.js';
import { splitHash } from './buckets.js';
import { childResolver, loadAllocationInputs, loadCascadeChildren } from './cascade-load.js';
import { DEFAULT_CASCADE_DEPTH, DEFAULT_CASCADE_NODES, resolveCascade, type CascadeResult } from './cascade.js';
import { loadPayoutAddresses } from './payout.js';
import { advanceRights, rightsRegression, type RightsTable } from './rights.js';
import type { ResourceBase } from './resources.js';
import type { Standing } from './standing.js';

export const DEFAULT_RIGHTS_HOLONS = 50;

export interface CutRightsOptions {
  /** The last table the Pot committed (from the `flow_rights` log), or null for the first. */
  previous: RightsTable | null | undefined;
  /** The lunation being cut (`lunationAt().index`). */
  epoch: number;
  /** The chain the Pot is on; payout addresses are read for it. */
  chainId: number;
  /** Token → the Pot's cumulative `received` now, base units. */
  received: Record<string, bigint>;
  /** The scored roster of an equation-mode holon. Absent: no contributor seats resolve. */
  scoreOf?: (holonId: string) => Promise<AllocationMember[]>;
  /** Who exited and who is in need, per holon (`standing-load.ts`). Absent: nobody. */
  standingOf?: (holonId: string) => Promise<Standing>;
  /** A holon's resource base, for funds whose split is `resourced` (`resources-load.ts`). Absent: zones alone. */
  resourcesOf?: (holonId: string) => Promise<ResourceBase>;
  /** Party → payout address; default reads every party's settings. */
  addressOf?: (party: string) => string | null | undefined;
  maxHolons?: number;
  maxDepth?: number;
  /**
   * Nodes the resolved tree may hold. Default: room for every holon read to
   * seat its people — a walk allowed more holons is allowed the nodes for them.
   */
  maxNodes?: number;
  /** The clock a claim window is read against. Default: now. */
  now?: number;
}

/** People a holon is given room to seat when the node bound follows the holon bound. */
const NODES_PER_HOLON = 20;

export interface CutRights {
  table: RightsTable | null;
  cascade: CascadeResult | null;
  /** Party → share of the root pot, as the table divided by. */
  shares: Record<string, number>;
  /** Every holon in the cascade was followed to its leaves. False: do not sign. */
  complete: boolean;
  /** Why the table is not fit to commit, in order found; empty when it is. */
  problems: string[];
  /** Parties the root's own standing retired: they keep their rows and take no new income. */
  exited: string[];
  /** Seats of the root left unclaimed past its claim window: retired the same way. */
  lapsed: string[];
}

/** The table for `holonId`'s Pot this lunation, read from the store. */
export async function cutRights(holosphere: any, holonId: string, opts: CutRightsOptions): Promise<CutRights> {
  const holon = String(holonId ?? '');
  const none: CutRights = { table: null, cascade: null, shares: {}, complete: false, problems: [], exited: [], lapsed: [] };
  if (!holosphere || !holon) return { ...none, problems: ['no holon'] };

  const inputs = await loadAllocationInputs(holosphere, holon, { scoreOf: opts.scoreOf, standingOf: opts.standingOf, resourcesOf: opts.resourcesOf, now: opts.now });
  if (!inputs.configured) return { ...none, problems: ['the holon has no allocation'] };
  const root = { config: inputs.config, members: inputs.members, zoned: inputs.zoned };
  const rootPartyIds = [...new Set([...inputs.members.map((m) => m.id), ...inputs.zoned.filter((p) => p.zone >= 1).map((p) => p.id)])];
  const exited = Object.keys(inputs.standing?.exited ?? {});

  const loaded = await loadCascadeChildren(holosphere, rootPartyIds, {
    rootId: holon,
    maxDepth: opts.maxDepth,
    maxHolons: opts.maxHolons ?? DEFAULT_RIGHTS_HOLONS,
    scoreOf: opts.scoreOf,
    standingOf: opts.standingOf,
    resourcesOf: opts.resourcesOf,
    now: opts.now,
  });
  const cascade = resolveCascade({
    holonId: holon,
    total: null,
    root,
    resolveChild: childResolver(loaded.children),
    maxDepth: opts.maxDepth ?? DEFAULT_CASCADE_DEPTH,
    maxNodes: opts.maxNodes ?? Math.max(DEFAULT_CASCADE_NODES, (opts.maxHolons ?? DEFAULT_RIGHTS_HOLONS) * NODES_PER_HOLON),
  });

  const problems: string[] = [];
  // A split pinned at genesis is the promise the Pot pays on: a root whose
  // rule moved — buckets, weights, the contributors' percent — is not signed.
  if (inputs.genesis) {
    const now = splitHash({ interiorPercent: inputs.config.interiorPercent, buckets: inputs.buckets, shares: inputs.shares });
    if (now !== inputs.genesis.hash) problems.push('the split differs from genesis');
  }
  if (loaded.truncated) problems.push(`the cascade walk stopped at ${loaded.visited} holons`);
  if (cascade.truncated) problems.push('the cascade reached its depth or node bound');
  const shares: Record<string, number> = {};
  for (const [party, leaf] of Object.entries(cascade.leaves)) if (leaf.percentage > 0) shares[party] = leaf.percentage;
  const complete = problems.length === 0;

  let addressOf = opts.addressOf;
  if (!addressOf) {
    const found = await loadPayoutAddresses(holosphere, [...Object.keys(shares), ...(opts.previous?.rows.map((r) => r.party) ?? [])], opts.chainId);
    addressOf = (party: string) => found[party] ?? null;
  }

  let table: RightsTable | null = null;
  try {
    table = advanceRights({ previous: opts.previous, epoch: opts.epoch, shares, received: opts.received, addressOf });
    problems.push(...rightsRegression(opts.previous, table));
  } catch (err) {
    problems.push(err instanceof Error ? err.message : String(err));
  }

  return { table, cascade, shares, complete: complete && table != null && problems.length === 0, problems, exited, lapsed: inputs.lapsed };
}
