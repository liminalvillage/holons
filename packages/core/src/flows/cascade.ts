// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cascading allocation — a share that is itself divided again.
 *
 * `allocate` answers where ONE holon's value goes, and stops at whoever
 * receives it. But a recipient can be a holon with a split of its own: a
 * member's id is their personal holon's id, a reciprocity partner is a holon
 * outright. When that holon has configured an allocation, what it receives
 * does not rest there — it is divided again by ITS rules, and so on down.
 *
 *   collective ──equal──▶ member ──their zones──▶ the people they give to
 *                           └─ their contributors share: what they keep
 *
 * This is the same thing the Bundle contract does on-chain when a member's
 * bound address is another Bundle, and the same thing the rights bookkeeping
 * needs off-chain — so it lives here once, rail-agnostic and pure. The caller
 * supplies `resolveChild`, which says whether a party has a split of its own;
 * `cascade-load.ts` builds one from the settings lens.
 *
 * Everything is worked in percent of the ROOT pot. `allocate` is linear in
 * its total, so amounts are derived once at the end and a percentage-only
 * cascade (no pot known) costs nothing extra.
 *
 * Every unit of the pot ends at exactly one leaf, and each leaf says why it
 * stopped there:
 *
 *   terminal — the recipient has no split of their own
 *   kept     — the recipient is the holon doing the dividing: the owner of a
 *              personal holon seated in their own contributors share
 *   retained — the holon's split names nobody for this part (no roster, no
 *              one placed), so it stays with the holon. For a personal holon
 *              that is the owner keeping it, the same leaf as `kept`
 *   cycle    — the recipient is already upstream on this path; the value
 *              stops with them rather than going round again
 *   depth    — the recipient would pass it on, but `maxDepth` was reached
 *   budget   — likewise, but `maxNodes` was reached
 *
 * The cycle guard reads the current PATH, not everything visited: two members
 * giving to the same third person is a diamond, not a loop, and both paths
 * add into that person's one leaf.
 */

import {
  allocate,
  type AllocationConfig,
  type AllocationMember,
  type AllocationPartner,
  type AllocationResult,
  type AllocationSlice,
} from './allocation.js';

/** What `allocate` needs to divide one holon's share. */
export interface CascadeInputs {
  config: AllocationConfig;
  members: AllocationMember[];
  zoned: AllocationPartner[];
  /** The holon's display name, when the caller knows a better one. */
  name?: string;
}

/**
 * A party's own split, or null when what it receives rests with it.
 * `path` is the chain of holons from the root down to the one paying.
 */
export type ResolveChild = (partyId: string, path: readonly string[]) => CascadeInputs | null;

export type CascadeLeafReason = 'terminal' | 'kept' | 'retained' | 'cycle' | 'depth' | 'budget';

export interface CascadeNode {
  id: string;
  label: string;
  /** Share of the ROOT pot that reaches this node, 0..100. */
  percentage: number;
  /** `null` when no pot is known (percentage-only). */
  amount: number | null;
  /** The side of its parent's split this came through. */
  via: 'root' | 'interior' | 'exterior';
  /** Exterior only: the ring, when the whole share came through one ring. */
  zone?: number;
  /** 0 for the root, 1 for whoever it pays, and so on. */
  depth: number;
  /** Set on leaves only: why the value stops here. */
  reason?: CascadeLeafReason;
  children: CascadeNode[];
}

export interface CascadeLeaf {
  label: string;
  percentage: number;
  amount: number | null;
}

export interface CascadeResult {
  root: CascadeNode;
  /** The root's own `allocate` result, untouched — what the first columns draw. */
  rootResult: AllocationResult;
  unit: string;
  total: number | null;
  /** Where the pot ends up, by party id. Sums to 100 / to `total`. */
  leaves: Record<string, CascadeLeaf>;
  /** Every loop met, as the path from the root to the revisited party. */
  cycles: string[][];
  nodeCount: number;
  maxDepthReached: number;
  /** A depth or node bound cut something that would have gone further. */
  truncated: boolean;
}

export const DEFAULT_CASCADE_DEPTH = 3;
export const DEFAULT_CASCADE_NODES = 500;

/** Below this share of the root pot a remainder is rounding, not a holding. */
const EPSILON = 1e-9;

interface Recipient {
  id: string;
  label: string;
  percentage: number;
  via: 'interior' | 'exterior';
  zone?: number;
}

/** One entry per party, however many seats it holds in this holon. */
function recipientsOf(result: AllocationResult): Recipient[] {
  const byId = new Map<string, Recipient>();
  const add = (slice: AllocationSlice, via: 'interior' | 'exterior') => {
    if (!(slice.percentage > 0)) return;
    const seen = byId.get(slice.id);
    if (!seen) {
      byId.set(slice.id, {
        id: slice.id,
        label: slice.label,
        percentage: slice.percentage,
        via,
        ...(slice.zone != null ? { zone: slice.zone } : {}),
      });
      return;
    }
    seen.percentage += slice.percentage;
    // Two seats are not one ring; the contributor seat names the party.
    delete seen.zone;
  };
  for (const member of result.interior) add(member, 'interior');
  for (const zone of result.exterior) {
    for (const partner of zone.members ?? []) add(partner, 'exterior');
  }
  return [...byId.values()];
}

export function resolveCascade(input: {
  holonId: string;
  total: number | null;
  unit?: string;
  root: CascadeInputs;
  resolveChild: ResolveChild;
  /** How many hops of passing-on are followed below the root. */
  maxDepth?: number;
  maxNodes?: number;
}): CascadeResult {
  const holonId = String(input.holonId ?? '');
  const maxDepth = Math.max(0, Math.floor(input.maxDepth ?? DEFAULT_CASCADE_DEPTH));
  const maxNodes = Math.max(1, Math.floor(input.maxNodes ?? DEFAULT_CASCADE_NODES));

  const rootResult = allocate({
    total: input.total,
    unit: input.unit,
    config: input.root.config,
    members: input.root.members,
    zoned: input.root.zoned,
  });
  const total = rootResult.total;
  const amountOf = (percentage: number) => (total == null ? null : (percentage / 100) * total);

  const leaves: Record<string, CascadeLeaf> = {};
  const cycles: string[][] = [];
  let nodeCount = 0;
  let maxDepthReached = 0;
  let truncated = false;

  const make = (
    id: string,
    label: string,
    percentage: number,
    via: CascadeNode['via'],
    depth: number,
    zone?: number,
  ): CascadeNode => {
    nodeCount += 1;
    if (depth > maxDepthReached) maxDepthReached = depth;
    return {
      id,
      label,
      percentage,
      amount: amountOf(percentage),
      via,
      ...(zone != null ? { zone } : {}),
      depth,
      children: [],
    };
  };

  const rest = (node: CascadeNode, reason: CascadeLeafReason): CascadeNode => {
    node.reason = reason;
    const leaf = leaves[node.id];
    if (leaf) leaf.percentage += node.percentage;
    else leaves[node.id] = { label: node.label, percentage: node.percentage, amount: null };
    return node;
  };

  /** Divide `node`'s share by `result`, the split of the holon it stands for. */
  const divide = (node: CascadeNode, result: AllocationResult, path: string[]): void => {
    let paid = 0;
    for (const recipient of recipientsOf(result)) {
      const percentage = (node.percentage * recipient.percentage) / 100;
      paid += recipient.percentage;
      const child = make(recipient.id, recipient.label, percentage, recipient.via, node.depth + 1, recipient.zone);
      node.children.push(child);

      if (recipient.id === node.id) {
        rest(child, 'kept');
        continue;
      }
      if (path.includes(recipient.id)) {
        cycles.push([...path, recipient.id]);
        rest(child, 'cycle');
        continue;
      }
      const own = input.resolveChild(recipient.id, path);
      if (!own) {
        rest(child, 'terminal');
        continue;
      }
      if (child.depth > maxDepth) {
        truncated = true;
        rest(child, 'depth');
        continue;
      }
      if (nodeCount >= maxNodes) {
        truncated = true;
        rest(child, 'budget');
        continue;
      }
      if (own.name) child.label = own.name;
      divide(
        child,
        allocate({ total: null, config: own.config, members: own.members, zoned: own.zoned }),
        [...path, recipient.id],
      );
    }

    // Whatever this split names nobody for stays with the holon itself.
    const held = (node.percentage * Math.max(0, 100 - paid)) / 100;
    if (held > EPSILON) {
      node.children.push(rest(make(node.id, node.label, held, node.via, node.depth + 1), 'retained'));
    }
  };

  const root = make(holonId, input.root.name || holonId, 100, 'root', 0);
  divide(root, rootResult, [holonId]);

  for (const leaf of Object.values(leaves)) leaf.amount = amountOf(leaf.percentage);

  return {
    root,
    rootResult,
    unit: rootResult.unit,
    total,
    leaves,
    cycles,
    nodeCount,
    maxDepthReached,
    truncated,
  };
}

export interface CascadeSummary {
  cycles: string[][];
  nodeCount: number;
  maxDepth: number;
  /**
   * Holons whose split names nobody for part of what they receive. Off-chain
   * that part simply stays with the holon; on-chain a Bundle has no withdraw,
   * so the same part is stranded in the contract. A pre-flight warns on these.
   */
  stuck: string[];
}

/** What a pre-flight needs to know before a cascade is trusted with money. */
export function summarizeCascade(result: CascadeResult): CascadeSummary {
  const stuck = new Set<string>();
  const walk = (node: CascadeNode) => {
    if (node.reason === 'retained') stuck.add(node.id);
    node.children.forEach(walk);
  };
  walk(result.root);
  return {
    cycles: result.cycles,
    nodeCount: result.nodeCount,
    maxDepth: result.maxDepthReached,
    stuck: [...stuck],
  };
}

/**
 * The cascade's outcome in the shape `fundAccount` reads: every party that
 * ends up holding part of the root fund, with the share they hold AFTER
 * passing on what their own split sends further.
 *
 * A party the root seats keeps its side and ring; someone reached only
 * downstream is listed on the exterior with no ring of the root's — they are
 * a rights-holder of this fund through someone else's giving. What the root
 * itself holds back is not a right and is left out.
 *
 * For accounts only. The diagram is `cascadeToGraph`, which needs the paths.
 */
export function cascadeRights(result: CascadeResult): AllocationResult {
  const { rootResult, total } = result;
  const amountOf = (percentage: number) => (total == null ? null : (percentage / 100) * total);

  // What the root grants each party, across its seats, to apportion a leaf by.
  const granted = new Map<string, number>();
  for (const seat of recipientsOf(rootResult)) granted.set(seat.id, seat.percentage);

  const seated = new Set<string>();
  const reseat = (slice: AllocationSlice): AllocationSlice | null => {
    const leaf = result.leaves[slice.id];
    const gross = granted.get(slice.id) ?? 0;
    if (!leaf || !(gross > 0) || !(slice.percentage > 0)) return null;
    seated.add(slice.id);
    const percentage = (leaf.percentage * slice.percentage) / gross;
    return { ...slice, percentage, amount: amountOf(percentage) };
  };

  const interior = rootResult.interior
    .map(reseat)
    .filter((s): s is AllocationSlice => s != null);

  const exterior: AllocationSlice[] = rootResult.exterior.map((zone) => {
    const members = (zone.members ?? []).map(reseat).filter((s): s is AllocationSlice => s != null);
    const percentage = members.reduce((sum, m) => sum + m.percentage, 0);
    return { ...zone, percentage, amount: amountOf(percentage), members };
  });

  const downstream: AllocationSlice[] = Object.entries(result.leaves)
    .filter(([id]) => id !== result.root.id && !seated.has(id))
    .map(([id, leaf]) => ({
      id,
      label: leaf.label,
      percentage: leaf.percentage,
      amount: amountOf(leaf.percentage),
      side: 'exterior' as const,
    }));
  if (downstream.length) {
    const percentage = downstream.reduce((sum, m) => sum + m.percentage, 0);
    exterior.push({
      id: 'downstream',
      label: 'Passed on',
      percentage,
      amount: amountOf(percentage),
      side: 'exterior',
      members: downstream,
    });
  }

  return { config: rootResult.config, unit: rootResult.unit, total, interior, exterior };
}
