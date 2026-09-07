// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Allocation, expressed as a flow graph.
 *
 * An allocation IS a flow — value moving outward from the pot to the people and
 * partners who receive it — so it renders in the same visual language as the
 * movement half instead of needing a second chart type. That buys one layout
 * function, one renderer per app, and no d3 in the kiosk.
 *
 * Columns:
 *
 *   0  the pot
 *   1  interior / exterior
 *   2  zones (exterior)
 *   3  the parties — members and partners, one bar each
 *
 * A party is one bar whoever feeds it. A contributor's ribbon runs from the
 * interior branch straight to their bar, skipping the zone column; a partner's
 * ribbon comes through their zone. Someone who is both — a member also placed
 * on a ring — gets both ribbons into the SAME bar, so the bar's height is what
 * they receive in total and the two ribbons say where it comes from. Without
 * anyone placed on a zone the party column moves up to depth 2, beside the
 * empty zones; a zone with no partners terminates there either way.
 *
 * With `usage` — and a real pot, since percentages cannot be spent — each
 * party's bar is drawn STACKED: what they have taken out, what they are still
 * owed, and what is left to them, top to bottom, as `segments` on the node.
 * The rightmost edge of the chart then answers both questions at once: how
 * much each person gets, and how much of it is already gone. A right that has
 * been overrun grows an "over" segment past the right: the bar is taller than
 * what feeds it, which is exactly what happened. Money the collective paid to
 * someone with no right at all takes its own branch off the pot, stacked the
 * same way, so the fund still adds up.
 *
 * What a Sankey cannot show that the concentric chart could: ring nesting, the
 * sense of a zone's distance from the centre. The zone number stays on every
 * label, so the ordering is still readable, and a ring renderer could be added
 * later over this same `AllocationResult` — nothing here forecloses it.
 */

import type { AllocationResult } from './allocation.js';
import type { ValueFlowLink, ValueFlowNode, ValueFlowSegment, ValueFlowTrack } from './types.js';
import { usageOf, usageTotals, type FundUsage, type FundUse } from './usage.js';

const POT_ID = '__pot';
const INTERIOR_ID = '__interior';
const EXTERIOR_ID = '__exterior';
export const UNATTRIBUTED_ID = '__unattributed';

const PARTY_PREFIX = 'party-';
/** The node id a party — member or partner — is drawn under. */
export const partyNodeId = (partyId: string): string => `${PARTY_PREFIX}${partyId}`;
/** The party behind a node id, or null for a structural bar. */
export const partyIdOf = (nodeId: string): string | null =>
  nodeId.startsWith(PARTY_PREFIX) ? nodeId.slice(PARTY_PREFIX.length) : null;

/** The kinds a stacked usage bar is made of, top to bottom. */
export type UsageSegmentKind = 'spent' | 'claimed' | 'available' | 'over';
export const USAGE_SEGMENT_KINDS: readonly UsageSegmentKind[] = ['spent', 'claimed', 'available', 'over'];

export interface AllocationGraphLabels {
  pot?: string;
  interior?: string;
  exterior?: string;
  /** Segment labels, only read when usage is drawn. */
  spent?: string;
  claimed?: string;
  available?: string;
  over?: string;
  unattributed?: string;
}

/**
 * Turn an allocation into a `ValueFlowTrack` for `layoutSankey`.
 *
 * Values are amounts when the pot is known, and percentages when it is not, so
 * the diagram is meaningful either way — an unconfigured collective still shows
 * the shape of the split.
 */
export function allocationToGraph(
  result: AllocationResult,
  labels: AllocationGraphLabels = {},
  usage: FundUsage | null = null,
): ValueFlowTrack {
  const nodes: ValueFlowNode[] = [];
  const links: ValueFlowLink[] = [];

  // Amounts when we have a pot, percentages when we don't.
  const scale = result.total ?? 100;
  const valueOf = (percentage: number) => (percentage / 100) * scale;

  // Usage only reads against a real pot: a percentage cannot be spent.
  const drawUsage = usage != null && result.total != null;
  const unattributed = drawUsage
    ? usageTotals(usage).unattributed
    : { spent: 0, claimed: 0 };
  const unattributedValue = unattributed.spent + unattributed.claimed;

  const interiorPct = result.interior.reduce((s, m) => s + m.percentage, 0);
  const exteriorPct = result.exterior.reduce((s, z) => s + z.percentage, 0);
  const rightsValue = valueOf(interiorPct + exteriorPct);
  const potValue = rightsValue + unattributedValue;

  if (potValue <= 0) {
    return {
      id: 'allocation',
      unit: result.unit,
      nodes: [],
      links: [],
      totalIn: 0,
      totalOut: 0,
      balance: result.total,
    };
  }

  const segmentLabel: Record<UsageSegmentKind, string> = {
    spent: labels.spent ?? 'Spent',
    claimed: labels.claimed ?? 'Claimed',
    available: labels.available ?? 'Available',
    over: labels.over ?? 'Over',
  };

  /**
   * Stack a right into what has been used. `spent` and `claimed` each take
   * what the right can carry, in that order; anything beyond it is the
   * overrun, and the bar grows by that much so it is drawn rather than
   * clipped. Only slices with something in them are emitted.
   */
  const stack = (right: number, use: FundUse): { value: number; segments: ValueFlowSegment[] } => {
    const spent = Math.min(use.spent, right);
    const claimed = Math.min(use.claimed, Math.max(0, right - spent));
    const over = use.spent - spent + (use.claimed - claimed);
    const available = Math.max(0, right - spent - claimed);
    const slices: [UsageSegmentKind, number][] = [
      ['spent', spent],
      ['claimed', claimed],
      ['available', available],
      ['over', over],
    ];
    const segments = slices
      .filter(([, value]) => value > 0)
      .map(([kind, value]) => ({ kind, label: segmentLabel[kind], value }));
    return { value: right + over, segments };
  };

  // The party column sits after the deepest thing that feeds it.
  const hasPartners = result.exterior.some((zone) =>
    (zone.members ?? []).some((p) => p.percentage > 0),
  );
  const partyDepth = hasPartners ? 3 : 2;

  // One bar per party, however many seats they hold.
  const parties = new Map<string, ValueFlowNode>();
  const party = (id: string, label: string, kind: 'member' | 'partner', value: number): ValueFlowNode => {
    const nodeId = partyNodeId(id);
    let node = parties.get(nodeId);
    if (!node) {
      node = { id: nodeId, label, depth: partyDepth, value: 0, kind };
      parties.set(nodeId, node);
      nodes.push(node);
    } else if (kind === 'member') {
      // A member's seat names the bar: their contribution is why it is here.
      node.kind = 'member';
    }
    node.value += value;
    return node;
  };

  nodes.push({
    id: POT_ID,
    label: labels.pot ?? 'Total',
    depth: 0,
    value: potValue,
    kind: 'pot',
  });

  if (interiorPct > 0) {
    nodes.push({
      id: INTERIOR_ID,
      label: labels.interior ?? 'Interior',
      depth: 1,
      value: valueOf(interiorPct),
      kind: 'interior',
    });
    links.push({
      id: `${POT_ID}-${INTERIOR_ID}`,
      source: POT_ID,
      target: INTERIOR_ID,
      value: valueOf(interiorPct),
      kind: 'interior',
    });

    for (const member of result.interior) {
      if (member.percentage <= 0) continue;
      const value = valueOf(member.percentage);
      const node = party(member.id, member.label, 'member', value);
      links.push({
        id: `${INTERIOR_ID}-${member.id}`,
        source: INTERIOR_ID,
        target: node.id,
        value,
        kind: 'interior',
      });
    }
  }

  if (exteriorPct > 0) {
    nodes.push({
      id: EXTERIOR_ID,
      label: labels.exterior ?? 'Exterior',
      depth: 1,
      value: valueOf(exteriorPct),
      kind: 'exterior',
    });
    links.push({
      id: `${POT_ID}-${EXTERIOR_ID}`,
      source: POT_ID,
      target: EXTERIOR_ID,
      value: valueOf(exteriorPct),
      kind: 'exterior',
    });

    for (const zone of result.exterior) {
      if (zone.percentage <= 0) continue;
      const value = valueOf(zone.percentage);
      nodes.push({
        id: `zone-${zone.zone}`,
        label: zone.label,
        depth: 2,
        value,
        kind: 'zone',
      });
      links.push({
        id: `${EXTERIOR_ID}-zone-${zone.zone}`,
        source: EXTERIOR_ID,
        target: `zone-${zone.zone}`,
        value,
        kind: 'exterior',
      });

      for (const partner of zone.members ?? []) {
        if (partner.percentage <= 0) continue;
        const partnerValue = valueOf(partner.percentage);
        const node = party(partner.id, partner.label, 'partner', partnerValue);
        links.push({
          id: `zone-${zone.zone}-${partner.id}`,
          source: `zone-${zone.zone}`,
          target: node.id,
          value: partnerValue,
          kind: 'exterior',
        });
      }
    }
  }

  // Every party's right, stacked into what they have made of it — once per
  // party, over the whole of their right, however many seats fed it.
  if (drawUsage) {
    for (const node of parties.values()) {
      const stacked = stack(node.value, usageOf(usage, partyIdOf(node.id)!));
      node.value = stacked.value;
      node.segments = stacked.segments;
    }
  }

  // Paid or promised to someone with no right: its own branch off the pot,
  // stacked like a right that was all used, so the fund still adds up.
  if (unattributedValue > 0) {
    nodes.push({
      id: UNATTRIBUTED_ID,
      label: labels.unattributed ?? 'Outside rights',
      depth: 1,
      value: unattributedValue,
      kind: 'unattributed',
      segments: stack(unattributedValue, unattributed).segments,
    });
    links.push({
      id: `${POT_ID}-${UNATTRIBUTED_ID}`,
      source: POT_ID,
      target: UNATTRIBUTED_ID,
      value: unattributedValue,
      kind: 'unattributed',
    });
  }

  return {
    id: 'allocation',
    unit: result.unit,
    nodes,
    links,
    totalIn: potValue,
    totalOut: potValue,
    balance: result.total,
  };
}

/**
 * How much of one kind the whole diagram holds in its stacked bars — the
 * "available" left to everyone, the "over" taken beyond every right.
 */
export function segmentTotal(track: ValueFlowTrack, kind: string): number {
  let total = 0;
  for (const node of track.nodes ?? []) {
    for (const segment of node.segments ?? []) {
      if (segment.kind === kind) total += segment.value;
    }
  }
  return total;
}
