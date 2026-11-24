// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  balances,
  cascadeFrom,
  circleScores,
  claim,
  collect,
  commitRightsRoot,
  createSim,
  deposit,
  flowGraph,
  step,
  tasksIn,
  unitsSeen,
  type SimState,
} from './engine.js';
import { LUNATION_DAYS, PEOPLE, RAIL_UNIT } from './scenario.js';

const runDays = (s: SimState, days: number) => {
  for (let i = 0; i < days; i++) step(s);
};

const runFullLunation = (seed = 7): SimState => {
  const s = createSim(seed);
  runDays(s, LUNATION_DAYS);
  return s;
};

describe('determinism', () => {
  it('the same seed produces identical event texts; a different seed differs', () => {
    const a = runFullLunation(7);
    const b = runFullLunation(7);
    const c = runFullLunation(8);
    const textsA = a.events.map((e) => e.text);
    const textsB = b.events.map((e) => e.text);
    const textsC = c.events.map((e) => e.text);
    expect(textsB).toEqual(textsA);
    expect(textsC).not.toEqual(textsA);
  });
});

describe('conservation', () => {
  it('every unit, routed through the flow graph, lands on people and holons and sums to what was deposited', () => {
    const s = runFullLunation(7);
    const units = unitsSeen(s);
    expect(units.length).toBeGreaterThan(0);
    for (const unit of units) {
      const g = flowGraph(s, unit);
      const toParties = g.links
        .filter((l) => l.target.startsWith('p:'))
        .reduce((sum, l) => sum + l.value, 0);
      const deposited = s.deposits.filter((d) => d.unit === unit).reduce((sum, d) => sum + d.amount, 0);
      expect(toParties, `unit ${unit}: party links vs graph total`).toBeCloseTo(g.total, 6);
      expect(g.total, `unit ${unit}: graph total vs deposits`).toBeCloseTo(deposited, 6);
    }
  });
});

describe('holograms', () => {
  it('a marketing feature request shows up in Engineering, and its status is shared with the hologram', () => {
    const s = runFullLunation(7);
    const requests = Object.values(s.tasks).filter(
      (t) => t.kind === 'feature-request' && t.holon === 'mkt' && t.holograms.includes('eng'),
    );
    expect(requests.length).toBeGreaterThan(0);

    const engRows = tasksIn(s, 'eng');
    const row = engRows.find((t) => t.id === requests[0].id);
    expect(row).toBeDefined();
    expect(row?.hologramOf).toBe('mkt');

    const done = requests.find((t) => t.status === 'done');
    expect(done, 'a completed request exists after a lunation').toBeDefined();
    const doneRow = engRows.find((t) => t.id === done!.id);
    expect(doneRow?.status).toBe('done');
  });
});

describe('content valued by views', () => {
  it('the writer with more views has the higher percentage, and Sasha scores 5 per edit', () => {
    const s = runFullLunation(7);
    const members = circleScores(s, 'content').members;
    const viewsOf = (id: string) => members.find((m) => m.id === id)!.tally.metrics.view ?? 0;
    const pctOf = (id: string) => members.find((m) => m.id === id)!.percentage;

    const [top, other] = viewsOf('lena') >= viewsOf('omar') ? ['lena', 'omar'] : ['omar', 'lena'];
    expect(viewsOf(top)).toBeGreaterThan(0);
    expect(pctOf(top)).toBeGreaterThan(pctOf(other));

    const sasha = members.find((m) => m.id === 'sasha')!;
    expect(sasha.score).toBeCloseTo(5 * (sasha.tally.metrics.edit ?? 0), 6);
  });
});

describe('egalitarian Operations', () => {
  it('Rosa and Ben get 50% each, whatever their activity', () => {
    const s = runFullLunation(7);
    const members = circleScores(s, 'ops').members;
    expect(members.map((m) => m.id).sort()).toEqual(['ben', 'rosa']);
    for (const m of members) expect(m.percentage).toBeCloseTo(50, 6);
  });
});

describe('personal splits cascade', () => {
  it('Lena keeps 90% and gives 10% to Omar', () => {
    const s = runFullLunation(7);
    const { leaves } = cascadeFrom(s, 'lena');
    expect(leaves.omar.percentage).toBeCloseTo(10, 6);
    expect(leaves.lena.percentage).toBeCloseTo(90, 6);
  });

  it("Kai's split gives 15% to the open-source commons", () => {
    const s = runFullLunation(7);
    const { leaves } = cascadeFrom(s, 'kai');
    expect(leaves.oss.percentage).toBeCloseTo(15, 6);
  });
});

describe('company cascade reaches everyone', () => {
  it('leaves of the company cascade sum to 100 and include each person', () => {
    const s = runFullLunation(7);
    const { leaves } = cascadeFrom(s, 'meridian');
    const total = Object.values(leaves).reduce((sum, l) => sum + l.percentage, 0);
    expect(total).toBeCloseTo(100, 6);
    for (const p of PEOPLE) expect(leaves[p.id], `leaf for ${p.id}`).toBeDefined();
  });
});

describe('claims (log rails)', () => {
  it('every person has an EUR share, and a claim pays it out exactly once', () => {
    const s = createSim(7);
    runDays(s, 3);
    deposit(s, { target: 'meridian', rail: 'opencollective', amount: 1000 });

    for (const p of PEOPLE) {
      const eur = balances(s).find((b) => b.id === p.id)?.units.EUR;
      expect(eur?.available ?? 0, `${p.id} available EUR`).toBeGreaterThan(0);
    }

    const before = balances(s).find((b) => b.id === 'ana')!.units.EUR!.available;
    const taken = claim(s, 'ana', 'EUR');
    expect(taken).toBeCloseTo(before, 2);

    const after = balances(s).find((b) => b.id === 'ana')!.units.EUR!;
    expect(after.available).toBe(0);
    expect(after.claimed).toBeCloseTo(before, 2);

    expect(claim(s, 'ana', 'EUR')).toBe(0);
  });
});

describe('pot rail', () => {
  it('a Pot deposit is pending until the rights root is committed, then collectable', () => {
    const s = createSim(7);
    runDays(s, 3);
    deposit(s, { target: 'meridian', rail: 'pot', amount: 500, unit: 'USDC' });

    const pre = balances(s).find((b) => b.id === 'sam')!.units.USDC!;
    expect(pre.pending).toBeGreaterThan(0);
    expect(pre.available).toBe(0);
    expect(pre.collectable).toBe(0);

    commitRightsRoot(s);

    const post = balances(s).find((b) => b.id === 'sam')!.units.USDC!;
    expect(post.pending).toBe(0);
    expect(post.collectable).toBeGreaterThan(0);

    const amount = post.collectable;
    expect(collect(s, 'sam', 'USDC')).toBeCloseTo(amount, 6);
    const afterCollect = balances(s).find((b) => b.id === 'sam')!.units.USDC!;
    expect(afterCollect.collectable).toBe(0);
  });
});

describe('rails and units', () => {
  it('each rail carries its own unit', () => {
    expect(RAIL_UNIT).toEqual({ nostr: 'SAT', opencollective: 'EUR', eth: 'ETH', pot: 'USDC' });
  });

  it('a nostr deposit shows up under SAT in balances', () => {
    const s = createSim(7);
    deposit(s, { target: 'meridian', rail: 'nostr', amount: 1000 });
    expect(unitsSeen(s)).toContain('SAT');
    const satRights = balances(s).map((b) => b.units.SAT?.right ?? 0);
    expect(satRights.reduce((a, b) => a + b, 0)).toBeCloseTo(1000, 2);
  });
});
