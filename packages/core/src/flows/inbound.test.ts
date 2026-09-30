// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { inboundRightFrom, loadInboundRights } from './inbound.js';
import { inboundTotal, rightsTotal } from './usage.js';

// The olive collective: two locations and the collectors seated on the
// mother's contributors side with hand-set weights; the pot is the harvest.
const MOTHER = 'olive';
const LIMINAL = '-100';
const CASA = '-200';
const COLLECTORS = '-300';
const motherSettings = {
  name: 'Olive Collective',
  allocation: {
    interiorPercent: 100,
    steepness: 50,
    nzones: 3,
    interiorMode: 'custom',
    shares: { [LIMINAL]: 25, [CASA]: 25, [COLLECTORS]: 50 },
    zones: {},
    people: {},
  },
};

describe('inboundRightFrom', () => {
  it('a seat on the contributors side is a right over the pot, weighted as set', () => {
    const r = inboundRightFrom({ upstreamId: MOTHER, upstreamSettings: motherSettings, pot: { unit: 'L', total: 200 }, holonId: COLLECTORS });
    expect(r).toEqual({ from: MOTHER, unit: 'L', right: 100, percentage: 50, pot: 200 });
    expect(inboundRightFrom({ upstreamId: MOTHER, upstreamSettings: motherSettings, pot: { unit: 'L', total: 200 }, holonId: LIMINAL })?.right).toBe(50);
  });

  it('a seat on a ring is a right too, and both seats add up', () => {
    const settings = {
      allocation: { interiorPercent: 60, steepness: 50, nzones: 2, interiorMode: 'custom', shares: { a: 1, [CASA]: 1 }, zones: { [CASA]: 1, [LIMINAL]: 1 } },
    };
    // Placed partners must be federated; both are.
    const casa = inboundRightFrom({ upstreamId: MOTHER, upstreamSettings: settings, pot: { unit: 'L', total: 100 }, holonId: CASA, federated: [CASA, LIMINAL] });
    expect(casa?.percentage).toBeCloseTo(30 + 20, 6);
    expect(casa?.right).toBe(50);
    // A partner the federation record no longer lists is not placed.
    const gone = inboundRightFrom({ upstreamId: MOTHER, upstreamSettings: settings, pot: { unit: 'L', total: 100 }, holonId: LIMINAL, federated: [CASA] });
    expect(gone).toBeNull();
    // Without a federation record the zones' own names stand.
    expect(inboundRightFrom({ upstreamId: MOTHER, upstreamSettings: settings, pot: { unit: 'L', total: 100 }, holonId: LIMINAL })?.right).toBe(20);
  });

  it('nothing reaches a holon the upstream does not seat, from an unconfigured upstream, or from an empty pot', () => {
    expect(inboundRightFrom({ upstreamId: MOTHER, upstreamSettings: motherSettings, pot: { unit: 'L', total: 200 }, holonId: 'someone' })).toBeNull();
    expect(inboundRightFrom({ upstreamId: MOTHER, upstreamSettings: { name: 'x' }, pot: { unit: 'L', total: 200 }, holonId: COLLECTORS })).toBeNull();
    expect(inboundRightFrom({ upstreamId: MOTHER, upstreamSettings: motherSettings, pot: { unit: 'L', total: 0 }, holonId: COLLECTORS })).toBeNull();
    expect(inboundRightFrom({ upstreamId: MOTHER, upstreamSettings: motherSettings, pot: { unit: 'L', total: 10 }, holonId: MOTHER })).toBeNull();
  });

  it('an equation-mode upstream resolves only with a scored roster', () => {
    const settings = { allocation: { interiorPercent: 100, steepness: 50, nzones: 1, interiorMode: 'equation' } };
    expect(inboundRightFrom({ upstreamId: MOTHER, upstreamSettings: settings, pot: { unit: 'L', total: 100 }, holonId: 'u1' })).toBeNull();
    const scored = [{ id: 'u1', name: 'Una', percentage: 75 }, { id: 'u2', name: 'Duo', percentage: 25 }];
    expect(inboundRightFrom({ upstreamId: MOTHER, upstreamSettings: settings, pot: { unit: 'L', total: 100 }, holonId: 'u1', scored })?.right).toBe(75);
  });
});

/** Settings and federation records by holon id; mints as pots per holon. */
function fakeHolosphere(settings: Record<string, any>, federation: Record<string, string[]>, failing: string[] = []) {
  const reads: string[] = [];
  return {
    reads,
    async get(holon: string, lens: string, key: string) {
      reads.push(`${lens}/${holon}/${key}`);
      if (failing.includes(holon)) throw new Error('quiet relay');
      return settings[holon] ?? null;
    },
    async getFederation(holon: string) {
      return { federated: federation[holon] ?? [], partnerNames: {} };
    },
  };
}

describe('loadInboundRights', () => {
  const federation = {
    [COLLECTORS]: [MOTHER],
    [LIMINAL]: [MOTHER, CASA],
    [CASA]: [MOTHER, LIMINAL],
    [MOTHER]: [LIMINAL, CASA, COLLECTORS],
  };
  const pots: Record<string, { unit: string; total: number }[]> = { [MOTHER]: [{ unit: 'L', total: 200 }] };
  const potsOf = async (id: string) => pots[id] ?? [];

  it('the collectors see half the harvest reaching them from the mother', async () => {
    const hs = fakeHolosphere({ [MOTHER]: motherSettings }, federation);
    const got = await loadInboundRights(hs, COLLECTORS, { potsOf });
    expect(got.inbound).toEqual([{ from: MOTHER, unit: 'L', right: 100, percentage: 50, pot: 200 }]);
    expect(got.upstreams).toEqual([MOTHER]);
    expect(inboundTotal(got.inbound, 'l')).toBe(100);
    // The collectors' own pot is what reaches them; nothing was drawn yet.
    expect(rightsTotal(0, null, inboundTotal(got.inbound, 'L'))).toBe(100);
  });

  it('a partner that seats nobody, or has no split, or cannot be read, contributes nothing', async () => {
    const hs = fakeHolosphere(
      { [MOTHER]: motherSettings, [CASA]: { allocation: { interiorPercent: 86, steepness: 35, nzones: 3, zones: {} } } },
      federation,
      [LIMINAL],
    );
    const got = await loadInboundRights(hs, CASA, { potsOf });
    expect(got.inbound.map((r) => r.from)).toEqual([MOTHER]);
    expect(got.upstreams).toEqual([MOTHER]);
  });

  it('climbs: a collective fed from above passes that pot on as part of its own', async () => {
    // A grandmother mints 400 L and seats the mother for half of it; the mother
    // mints 200 L of its own. The collectors' right is 50% of 400.
    const GRAND = 'grand';
    const hs = fakeHolosphere(
      {
        [MOTHER]: motherSettings,
        [GRAND]: { allocation: { interiorPercent: 100, interiorMode: 'custom', shares: { [MOTHER]: 1, other: 1 }, steepness: 50, nzones: 1 } },
      },
      { ...federation, [MOTHER]: [...federation[MOTHER], GRAND], [GRAND]: [MOTHER] },
    );
    const two = async (id: string) => (id === GRAND ? [{ unit: 'L', total: 400 }] : pots[id] ?? []);
    const got = await loadInboundRights(hs, COLLECTORS, { potsOf: two });
    expect(got.inbound).toEqual([{ from: MOTHER, unit: 'L', right: 200, percentage: 50, pot: 400 }]);
    // With one hop only, the grandmother's pot never reaches the mother's statement.
    const one = await loadInboundRights(hs, COLLECTORS, { potsOf: two, maxHops: 1 });
    expect(one.inbound[0].right).toBe(100);
  });

  it('units never mix: two pots upstream are two rights', async () => {
    const hs = fakeHolosphere({ [MOTHER]: motherSettings }, federation);
    const got = await loadInboundRights(hs, LIMINAL, { potsOf: async () => [{ unit: 'L', total: 200 }, { unit: 'EUR', total: 40 }] });
    expect(got.inbound.map((r) => [r.unit, r.right])).toEqual([['L', 50], ['EUR', 10]]);
  });

  it('is bounded and quiet: no holosphere, no id, or a read budget of zero', async () => {
    expect((await loadInboundRights(null, COLLECTORS)).inbound).toEqual([]);
    const hs = fakeHolosphere({ [MOTHER]: motherSettings }, federation);
    const got = await loadInboundRights(hs, COLLECTORS, { potsOf, maxHolons: 0 });
    expect(got.inbound).toEqual([]);
    expect(got.truncated).toBe(true);
  });
});
