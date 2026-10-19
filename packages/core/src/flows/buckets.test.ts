// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { allocate } from './allocation.js';
import {
  applyStanding,
  applyStandingToRings,
  composeInterior,
  lapsedSeats,
  normalizeAliases,
  normalizeBuckets,
  resolveAlias,
  splitHash,
  type AllocationBucket,
} from './buckets.js';

const legacy: AllocationBucket = { id: 'legacy', percent: 40, mode: 'custom', shares: { 'artisan:ada': 300, 'artisan:bo': 100 } };
const needs: AllocationBucket = { id: 'needs', percent: 30, mode: 'needs' };
const impact: AllocationBucket = { id: 'impact', percent: 30, mode: 'equation' };
const scored = [
  { id: 'ada', name: 'Ada', percentage: 75 },
  { id: 'cy', name: 'Cy', percentage: 25 },
];

const pct = (m: { id: string; percentage: number }[], id: string) => m.find((x) => x.id === id)?.percentage ?? 0;

describe('normalizeBuckets', () => {
  it('drops bad entries, duplicate ids and keeps custom shares clean', () => {
    const out = normalizeBuckets([
      legacy,
      { id: 'legacy', percent: 10, mode: 'custom' },
      { id: '', percent: 10, mode: 'equal' },
      { id: 'x', percent: -1, mode: 'equal' },
      { id: 'y', percent: 10, mode: 'nope' },
      { id: 'z', percent: '20', mode: 'equal', label: ' Everyone ' },
      { id: 'w', percent: 5, mode: 'equation', shares: { ignored: 1 } },
    ]);
    expect(out).toEqual([
      { id: 'legacy', percent: 40, mode: 'custom', shares: { 'artisan:ada': 300, 'artisan:bo': 100 } },
      { id: 'z', percent: 20, mode: 'equal', label: 'Everyone' },
      { id: 'w', percent: 5, mode: 'equation' },
    ]);
    expect(normalizeBuckets(null)).toEqual([]);
    expect(normalizeBuckets({ id: 'a' })).toEqual([]);
  });
});

describe('aliases', () => {
  it('normalizes and resolves one hop, never a chain', () => {
    const aliases = normalizeAliases({ 'artisan:ada': 'ada', ada: 'ada2', ' ': 'x', self: 'self' });
    expect(aliases).toEqual({ 'artisan:ada': 'ada', ada: 'ada2' });
    expect(resolveAlias(aliases, 'artisan:ada')).toBe('ada');
    expect(resolveAlias(aliases, 'zed')).toBe('zed');
    expect(resolveAlias(null, 'zed')).toBe('zed');
  });
});

describe('composeInterior', () => {
  it('divides each bucket by its own rule and adds the parts up per party', () => {
    const { members, byBucket, empty } = composeInterior({
      buckets: [legacy, needs, impact],
      scored,
      needs: ['bo', 'cy'],
      aliases: { 'artisan:ada': 'ada', 'artisan:bo': 'bo' },
    });
    expect(empty).toEqual([]);
    // legacy 40: ada 30, bo 10 · needs 30: bo 15, cy 15 · impact 30: ada 22.5, cy 7.5
    expect(pct(members, 'ada')).toBeCloseTo(52.5);
    expect(pct(members, 'bo')).toBeCloseTo(25);
    expect(pct(members, 'cy')).toBeCloseTo(22.5);
    expect(members.reduce((s, m) => s + m.percentage, 0)).toBeCloseTo(100);
    expect(byBucket.legacy).toEqual({ ada: 30, bo: 10 });
    expect(byBucket.needs).toEqual({ bo: 15, cy: 15 });
    expect(byBucket.impact).toEqual({ ada: 22.5, cy: 7.5 });
    expect(members.find((m) => m.id === 'ada')?.name).toBe('Ada');
    // sorted by id, so the roster is stable whatever the bucket order
    expect(members.map((m) => m.id)).toEqual(['ada', 'bo', 'cy']);
  });

  it('reads bucket percents against their own sum', () => {
    const { members } = composeInterior({ buckets: [{ ...legacy, percent: 1 }, { ...impact, percent: 3 }], scored });
    expect(pct(members, 'artisan:ada')).toBeCloseTo(18.75); // 25 % × 3/4
    expect(pct(members, 'ada')).toBeCloseTo(56.25); // 75 % × 3/4
  });

  it('an empty bucket pays nobody and its slice goes to the others', () => {
    const { members, byBucket, empty } = composeInterior({ buckets: [legacy, needs, impact], scored: [], needs: [] });
    expect(empty).toEqual(['needs', 'impact']);
    expect(byBucket.needs).toEqual({});
    expect(pct(members, 'artisan:ada')).toBeCloseTo(75);
    expect(pct(members, 'artisan:bo')).toBeCloseTo(25);
  });

  it('nobody in any bucket is no roster at all', () => {
    expect(composeInterior({ buckets: [needs, impact], scored: [] })).toEqual({ members: [], byBucket: { needs: {}, impact: {} }, empty: ['needs', 'impact'] });
    expect(composeInterior({ buckets: [], scored })).toEqual({ members: [], byBucket: {}, empty: [] });
  });

  it('an exit removes the party from every bucket', () => {
    const { members, byBucket } = composeInterior({
      buckets: [legacy, needs, impact],
      scored,
      needs: ['artisan:bo', 'cy'],
      exits: ['bo'],
      aliases: { 'artisan:ada': 'ada', 'artisan:bo': 'bo' },
    });
    expect(members.map((m) => m.id)).toEqual(['ada', 'cy']);
    expect(byBucket.legacy).toEqual({ ada: 40 });
    expect(byBucket.needs).toEqual({ cy: 30 });
    expect(members.reduce((s, m) => s + m.percentage, 0)).toBeCloseTo(100);
  });

  it('an alias merges a placeholder into the real party\'s row and the real party\'s own seat', () => {
    const { members } = composeInterior({
      buckets: [{ id: 'legacy', percent: 100, mode: 'custom', shares: { 'artisan:ada': 1, ada: 1, bo: 2 } }],
      scored: [],
      aliases: { 'artisan:ada': 'ada' },
    });
    expect(members).toEqual([
      { id: 'ada', name: 'ada', percentage: 50 },
      { id: 'bo', name: 'bo', percentage: 50 },
    ]);
  });

  it('a needs flag counts only for someone on the roster when a roster is given', () => {
    const { byBucket } = composeInterior({ buckets: [needs], scored: [], needs: ['ada', 'zed'], members: ['ada', 'bo'] });
    expect(byBucket.needs).toEqual({ ada: 100 });
    const open = composeInterior({ buckets: [needs], scored: [], needs: ['ada', 'zed'] });
    expect(open.byBucket.needs).toEqual({ ada: 50, zed: 50 });
  });

  it('an equal bucket divides among the roster, by default everyone the other buckets name', () => {
    const { byBucket } = composeInterior({ buckets: [legacy, { id: 'floor', percent: 50, mode: 'equal' }], scored: [{ id: 'cy', name: 'Cy', percentage: 1 }] });
    // floor is 50 of 90: 55.56 %, a third each
    expect(byBucket.floor).toEqual({ 'artisan:ada': expect.closeTo(18.52, 1), 'artisan:bo': expect.closeTo(18.52, 1), cy: expect.closeTo(18.52, 1) });
  });

  it('names come from the caller first, then the scored roster, then the id', () => {
    const { members } = composeInterior({ buckets: [impact, needs], scored, needs: ['bo'], nameOf: (id) => (id === 'bo' ? 'Bo' : undefined) });
    expect(members.map((m) => m.name)).toEqual(['Ada', 'Bo', 'Cy']);
  });

  it('feeds allocate unchanged: one slice per party, the interior filled exactly', () => {
    const { members } = composeInterior({ buckets: [legacy, impact], scored, aliases: { 'artisan:ada': 'ada' } });
    const result = allocate({ total: 1000, config: { interiorPercent: 100, steepness: 50, nzones: 0, interiorMode: 'custom' }, members, zoned: [] });
    expect(result.interior.map((s) => s.id)).toEqual(['ada', 'artisan:bo', 'cy']);
    expect(result.interior.reduce((s, m) => s + (m.amount ?? 0), 0)).toBeCloseTo(1000);
  });
});

describe('applyStanding', () => {
  it('resolves aliases, drops exits and merges duplicates on a plain roster', () => {
    const out = applyStanding(
      [
        { id: 'artisan:ada', name: 'artisan:ada', percentage: 30 },
        { id: 'ada', name: 'Ada', percentage: 20 },
        { id: 'bo', name: 'Bo', percentage: 50 },
      ],
      { aliases: { 'artisan:ada': 'ada' }, exits: ['bo'] },
    );
    expect(out).toEqual([{ id: 'ada', name: 'artisan:ada', percentage: 50 }]);
    expect(applyStanding([{ id: 'x', name: 'X', percentage: 1 }], {})).toEqual([{ id: 'x', name: 'X', percentage: 1 }]);
  });

  it('moves a ring with its alias and takes it from whoever exited', () => {
    expect(applyStandingToRings({ 'artisan:ada': 2, ada: 3, bo: 1 }, { aliases: { 'artisan:ada': 'ada' }, exits: ['bo'] })).toEqual({ ada: 2 });
  });
});

describe('lapsedSeats', () => {
  const pot: AllocationBucket = { id: 'legacy', percent: 100, mode: 'custom', shares: { fund: 400, claimed: 300, unclaimed: 300 } };
  const window = { until: 1000, keep: ['fund'] };
  const aliases = { claimed: '-100' };

  it('retires nobody while the window is open, or when there is none', () => {
    expect(lapsedSeats({ window, now: 999, buckets: [pot], aliases })).toEqual([]);
    expect(lapsedSeats({ window: null, now: 5000, buckets: [pot], aliases })).toEqual([]);
  });

  it('retires the seats nobody claimed once it closes, kept seats aside', () => {
    expect(lapsedSeats({ window, now: 1000, buckets: [pot], aliases })).toEqual(['unclaimed']);
    expect(lapsedSeats({ window: { until: 1000, keep: [] }, now: 2000, shares: { a: 1, b: 1 }, aliases: { a: 'x' } })).toEqual(['b']);
  });

  it('spreads a lapsed share over everyone left, in proportion', () => {
    const exits = lapsedSeats({ window, now: 2000, buckets: [pot], aliases });
    const { members } = composeInterior({ buckets: [pot], scored: [], exits, aliases });
    expect(pct(members, 'fund')).toBeCloseTo((400 / 700) * 100);
    expect(pct(members, '-100')).toBeCloseTo((300 / 700) * 100);
    expect(pct(members, 'unclaimed')).toBe(0);
  });
});

describe('splitHash', () => {
  it('is stable under key order and bucket order, blind to aliases, and moves with any weight', () => {
    const a = splitHash({ interiorPercent: 100, buckets: [legacy, impact] });
    const b = splitHash({ interiorPercent: 100, buckets: [impact, { ...legacy, shares: { 'artisan:bo': 100, 'artisan:ada': 300 } }] });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(splitHash({ interiorPercent: 100, buckets: [{ ...legacy, shares: { 'artisan:ada': 301, 'artisan:bo': 100 } }, impact] })).not.toBe(a);
    expect(splitHash({ interiorPercent: 99, buckets: [legacy, impact] })).not.toBe(a);
    expect(splitHash({ interiorPercent: 100, buckets: [{ ...legacy, percent: 41 }, impact] })).not.toBe(a);
  });

  it('pins a plain custom split when there are no buckets, and ignores it when there are', () => {
    const plain = splitHash({ interiorPercent: 60, shares: { a: 1, b: 2 } });
    expect(splitHash({ interiorPercent: 60, shares: { b: 2, a: 1 } })).toBe(plain);
    expect(splitHash({ interiorPercent: 60, shares: { a: 1, b: 3 } })).not.toBe(plain);
    expect(splitHash({ interiorPercent: 60, buckets: [impact], shares: { a: 1 } })).toBe(splitHash({ interiorPercent: 60, buckets: [impact], shares: { a: 9 } }));
  });
});
