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
 * Four columns:
 *
 *   0  the pot
 *   1  interior / exterior
 *   2  members (interior) and zones (exterior)
 *   3  federated partners, under their zone
 *
 * Members terminate at depth 2, and so do zones with no partners; the layout
 * allows a column to end early.
 *
 * What a Sankey cannot show that the concentric chart could: ring nesting, the
 * sense of a zone's distance from the centre. The zone number stays on every
 * label, so the ordering is still readable, and a ring renderer could be added
 * later over this same `AllocationResult` — nothing here forecloses it.
 */

import type { AllocationResult } from './allocation.js';
import type { ValueFlowLink, ValueFlowNode, ValueFlowTrack } from './types.js';

const POT_ID = '__pot';
const INTERIOR_ID = '__interior';
const EXTERIOR_ID = '__exterior';

export interface AllocationGraphLabels {
  pot?: string;
  interior?: string;
  exterior?: string;
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
): ValueFlowTrack {
  const nodes: ValueFlowNode[] = [];
  const links: ValueFlowLink[] = [];

  // Amounts when we have a pot, percentages when we don't.
  const scale = result.total ?? 100;
  const valueOf = (percentage: number) => (percentage / 100) * scale;

  const interiorPct = result.interior.reduce((s, m) => s + m.percentage, 0);
  const exteriorPct = result.exterior.reduce((s, z) => s + z.percentage, 0);
  const potValue = valueOf(interiorPct + exteriorPct);

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
      nodes.push({
        id: `member-${member.id}`,
        label: member.label,
        depth: 2,
        value,
        kind: 'member',
      });
      links.push({
        id: `${INTERIOR_ID}-${member.id}`,
        source: INTERIOR_ID,
        target: `member-${member.id}`,
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
        nodes.push({
          id: `partner-${partner.id}`,
          label: partner.label,
          depth: 3,
          value: partnerValue,
          kind: 'partner',
        });
        links.push({
          id: `zone-${zone.zone}-${partner.id}`,
          source: `zone-${zone.zone}`,
          target: `partner-${partner.id}`,
          value: partnerValue,
          kind: 'exterior',
        });
      }
    }
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
