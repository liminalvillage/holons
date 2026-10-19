// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { F1, F2, J, POT, diamond } from './flow-graph.fixture.js';
import { indexFlowGraph } from './flow-graph-index.js';
import { traceAmount } from './flow-graph-trace.js';

describe('traceAmount', () => {
  // Pot → F1 25, F2 25, J 50; F1, F2 → J; J → 111 ¾, artisan:9 ¼.
  const index = indexFlowGraph(diamond());

  it('follows €1,000 from the Pot to a person down every path, and the paths add up', () => {
    const t = traceAmount(index, '111', 1000);
    expect(t.paths.map((p) => [p.hops.map((h) => h.id), Math.round(p.amount * 100) / 100])).toEqual([
      [[POT, J, '111'], 375],
      [[POT, F1, J, '111'], 187.5],
      [[POT, F2, J, '111'], 187.5],
    ]);
    expect(t.reached).toBeCloseTo(750, 6);
    expect(t.reached).toBeCloseTo((1000 * index.byId.get('111')!.share) / 100, 6);
    expect(t.truncated).toBe(false);
    expect(t.paths[0].hops[1]).toMatchObject({ label: 'Project J', local: 50, amount: 500 });
  });

  it('starts anywhere on the map', () => {
    expect(traceAmount(index, '111', 100, { from: F1 }).reached).toBeCloseTo(75, 6);
  });

  it('reaches nothing for a party off the map or a zero amount', () => {
    expect(traceAmount(index, 'nobody', 1000).reached).toBe(0);
    expect(traceAmount(index, '111', 0).paths).toEqual([]);
  });

  it('says when a bound cut it short', () => {
    const t = traceAmount(index, '111', 1000, { maxPaths: 1 });
    expect(t.paths).toHaveLength(1);
    expect(t.truncated).toBe(true);
  });
});
