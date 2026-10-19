// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Shared by the flow-graph specs: a small Pot with the shapes the fork has.

import { resolveInteriorMembers, type AllocationConfig } from './allocation.js';
import { resolveCascade, type CascadeInputs } from './cascade.js';
import { buildFlowGraph, type FlowGraph, type FlowPartyMeta } from './flow-graph.js';

export const cfg = (interiorPercent: number, extra: Partial<AllocationConfig> = {}): AllocationConfig => ({
  interiorPercent,
  steepness: 50,
  nzones: 3,
  interiorMode: 'custom',
  ...extra,
});

/** A holon dividing everything among hand-set seats. */
export const seats = (shares: Record<string, number>, name?: string): CascadeInputs => ({
  config: cfg(100),
  members: resolveInteriorMembers({ config: { interiorMode: 'custom' }, scored: [], shares }),
  zoned: [],
  ...(name ? { name } : {}),
});

/** A fund: keeps `keep`%, the rest goes to the holons on ring 1. */
export const fund = (keep: number, ...onward: string[]): CascadeInputs => ({
  config: cfg(keep),
  members: [],
  zoned: onward.map((id) => ({ id, name: id, zone: 1, kind: 'holon' as const })),
});

export const POT = 'holon_pot';
export const F1 = 'holon_f1';
export const F2 = 'holon_f2';
export const J = 'holon_j';

/**
 * Two funds curate one project, which also has its own seat in the Pot:
 * Pot → F1 25, F2 25, J 50; each fund → J; J → 111 three parts, artisan:9 one.
 */
export function diamond(
  children: Record<string, CascadeInputs> = {},
  rest: { meta?: Record<string, FlowPartyMeta>; extra?: Record<string, CascadeInputs> } = {},
): FlowGraph {
  const all: Record<string, CascadeInputs> = {
    [F1]: fund(0, J),
    [F2]: fund(0, J),
    [J]: seats({ '111': 3, 'artisan:9': 1 }, 'Project J'),
    ...children,
  };
  const cascade = resolveCascade({
    holonId: POT,
    total: null,
    root: seats({ [F1]: 1, [F2]: 1, [J]: 2 }, 'The Pot'),
    resolveChild: (id) => all[id] ?? null,
  });
  return buildFlowGraph({ cascade, at: 1000, ...rest });
}
