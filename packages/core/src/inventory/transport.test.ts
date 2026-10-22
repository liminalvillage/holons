// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { FLAT_COST, federationCost, rebalancePlan, solveTransport, transportPlan } from './transport.js';

const total = (legs: Array<{ quantity: number; cost: number }>) =>
  legs.reduce((s, l) => s + l.quantity * l.cost, 0);

describe('transportPlan', () => {
  it('finds the true minimum, not the cheapest-cell greedy answer', () => {
    // Greedy takes A→X at 1 and is then forced into B→Y at 10 (total 110).
    // The optimum crosses over: A→Y and B→X (total 40).
    const cost = (from: string, to: string) =>
      ({ 'A:X': 1, 'A:Y': 2, 'B:X': 2, 'B:Y': 10 })[`${from}:${to}`]!;
    const legs = transportPlan(
      [{ id: 'A', supply: 10 }, { id: 'B', supply: 10 }],
      [{ id: 'X', demand: 10 }, { id: 'Y', demand: 10 }],
      cost,
    );
    expect(total(legs)).toBe(40);
    expect(legs).toEqual([
      { from: 'A', to: 'Y', quantity: 10, cost: 2 },
      { from: 'B', to: 'X', quantity: 10, cost: 2 },
    ]);
  });

  it('splits a source across sinks and moves only what both sides allow', () => {
    const legs = transportPlan([{ id: 'A', supply: 7 }], [{ id: 'X', demand: 4 }, { id: 'Y', demand: 5 }]);
    expect(legs.map((l) => [l.to, l.quantity]).sort()).toEqual([
      ['X', 4],
      ['Y', 3],
    ]);
    const spare = transportPlan([{ id: 'A', supply: 3 }, { id: 'B', supply: 3 }], [{ id: 'X', demand: 2 }]);
    expect(spare.reduce((s, l) => s + l.quantity, 0)).toBe(2);
  });

  it('never uses a forbidden leg, and leaves an unreachable sink short', () => {
    const cost = (from: string, to: string) => (from === 'A' && to === 'Y' ? Infinity : 1);
    const legs = transportPlan([{ id: 'A', supply: 5 }], [{ id: 'Y', demand: 5 }, { id: 'X', demand: 2 }], cost);
    expect(legs).toEqual([{ from: 'A', to: 'X', quantity: 2, cost: 1 }]);
  });

  it('returns nothing with no supply or no demand', () => {
    expect(transportPlan([], [{ id: 'X', demand: 1 }], FLAT_COST)).toEqual([]);
    expect(transportPlan([{ id: 'A', supply: 0 }], [{ id: 'X', demand: 1 }])).toEqual([]);
  });

  it('handles fractional quantities', () => {
    const legs = transportPlan([{ id: 'A', supply: 1.5 }], [{ id: 'X', demand: 0.7 }, { id: 'Y', demand: 2 }]);
    expect(legs.map((l) => [l.to, l.quantity]).sort()).toEqual([
      ['X', 0.7],
      ['Y', 0.8],
    ]);
  });
});

describe('federationCost', () => {
  const cost = federationCost({ a: ['b'], b: ['c'], d: [] });

  it('counts partnership hops in either direction', () => {
    expect(cost('a', 'b')).toBe(1);
    expect(cost('b', 'a')).toBe(1);
    expect(cost('a', 'c')).toBe(2);
    expect(cost('c', 'a')).toBe(2);
  });

  it('is free to oneself and impossible across no partnership', () => {
    expect(cost('a', 'a')).toBe(0);
    expect(cost('a', 'd')).toBe(Infinity);
    expect(cost('a', 'stranger')).toBe(Infinity);
  });
});

describe('rebalancePlan', () => {
  it('moves surplus to deficit per category, nearest partnership first', () => {
    const cost = federationCost({ near: ['short'], far: ['near'] });
    const plan = rebalancePlan(
      [
        { holonId: 'near', category: 'food', surplus: 3, deficit: 0 },
        { holonId: 'far', category: 'food', surplus: 10, deficit: 0 },
        { holonId: 'short', category: 'food', surplus: 0, deficit: 5 },
        { holonId: 'far', category: 'tools', surplus: 1, deficit: 0 },
        { holonId: 'short', category: 'tools', surplus: 0, deficit: 1 },
      ],
      cost,
    );
    expect(plan).toEqual([
      { category: 'food', from: 'near', to: 'short', quantity: 3, cost: 1 },
      { category: 'food', from: 'far', to: 'short', quantity: 2, cost: 2 },
      { category: 'tools', from: 'far', to: 'short', quantity: 1, cost: 2 },
    ]);
  });

  it('never moves across categories or to a holon outside the federation', () => {
    const plan = rebalancePlan(
      [
        { holonId: 'a', category: 'food', surplus: 5, deficit: 0 },
        { holonId: 'b', category: 'tools', surplus: 0, deficit: 5 },
        { holonId: 'c', category: 'food', surplus: 0, deficit: 5 },
      ],
      federationCost({ a: ['b'] }),
    );
    expect(plan).toEqual([]);
  });
});

describe('solveTransport', () => {
  const cost = (from: string, to: string) =>
    ({ 'A:X': 1, 'A:Y': 2, 'B:X': 2, 'B:Y': 10 })[`${from}:${to}`]!;
  const sources = [{ id: 'A', supply: 10 }, { id: 'B', supply: 10 }];
  const sinks = [{ id: 'X', demand: 10 }, { id: 'Y', demand: 10 }];

  it('is transportPlan plus the bookkeeping', () => {
    const sol = solveTransport(sources, sinks, cost);
    expect(sol.legs).toEqual(transportPlan(sources, sinks, cost));
    expect(sol.moved).toBe(20);
    expect(sol.unmet).toEqual({});
    expect(sol.unused).toEqual({});
  });

  it('certifies the optimum: tight on used legs, non-negative reduced cost elsewhere', () => {
    // A mixed board: partner hops (1, 2) beside grid distances (3, 7) and a forbidden leg.
    const mixed = (from: string, to: string) =>
      ({ 'A:X': 1, 'A:Y': 7, 'B:X': 2, 'B:Y': 3, 'C:X': Infinity, 'C:Y': 4 })[`${from}:${to}`]!;
    const srcs = [{ id: 'A', supply: 4 }, { id: 'B', supply: 4 }, { id: 'C', supply: 4 }];
    const snks = [{ id: 'X', demand: 6 }, { id: 'Y', demand: 5 }];
    const sol = solveTransport(srcs, snks, mixed);
    expect(sol.moved).toBe(11);
    const { sources: u, sinks: v } = sol.potentials;
    for (const leg of sol.legs) {
      expect(v[leg.to]).toBeCloseTo(u[leg.from] + leg.cost, 9);
    }
    for (const s of srcs) {
      for (const t of snks) {
        const c = mixed(s.id, t.id);
        if (!Number.isFinite(c) || !Number.isFinite(u[s.id]) || !Number.isFinite(v[t.id])) continue;
        expect(v[t.id]).toBeLessThanOrEqual(u[s.id] + c + 1e-9);
      }
    }
    // Optimal: A→X 4 (1), B→X 2 (2), B→Y 2 (3), C→Y 3 (4) = 4+4+6+12 = 26
    expect(total(sol.legs)).toBe(26);
  });

  it('prices an unreachable sink at unmetCost and reports it unmet', () => {
    const only = (from: string, to: string) => (to === 'Y' ? Infinity : 1);
    const sol = solveTransport([{ id: 'A', supply: 5 }], [{ id: 'X', demand: 2 }, { id: 'Y', demand: 3 }], only, {
      unmetCost: 100,
    });
    expect(sol.legs).toEqual([{ from: 'A', to: 'X', quantity: 2, cost: 1 }]);
    expect(sol.unmet).toEqual({ Y: 3 });
    expect(sol.unused).toEqual({ A: 3 });
    expect(sol.potentials.sinks.Y).toBe(100);
    expect(sol.potentials.sinks.X).toBeLessThan(100);
    // Without the virtual source the unreachable sink has no price.
    expect(solveTransport([{ id: 'A', supply: 5 }], [{ id: 'Y', demand: 3 }], only).potentials.sinks.Y).toBe(
      Infinity,
    );
  });

  it('the dearest served sink carries the highest finite price', () => {
    const c = (from: string, to: string) => ({ 'A:X': 1, 'A:Y': 5 })[`${from}:${to}`]!;
    const sol = solveTransport([{ id: 'A', supply: 10 }], [{ id: 'X', demand: 3 }, { id: 'Y', demand: 3 }], c, {
      unmetCost: 1000,
    });
    expect(sol.potentials.sinks.Y).toBeGreaterThan(sol.potentials.sinks.X);
    expect(sol.potentials.sinks.Y).toBe(5);
  });

  it('moves min(Σsupply, Σdemand) on a complete cost graph', () => {
    const sol = solveTransport([{ id: 'A', supply: 3 }, { id: 'B', supply: 3 }], [{ id: 'X', demand: 10 }], FLAT_COST);
    expect(sol.moved).toBe(6);
    expect(sol.unmet).toEqual({ X: 4 });
    expect(solveTransport([], [{ id: 'X', demand: 1 }]).unmet).toEqual({ X: 1 });
  });
});
