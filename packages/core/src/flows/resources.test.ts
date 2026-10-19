// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { bootstrapActors } from '../protocol/membership.js';
import { shuffled, signedEntry, testKey } from '../protocol/testing.js';
import { lunationAt } from './lunation.js';
import {
  CAPITALS,
  RESOURCE_NOTE_MAX,
  bandwidthWeights,
  buildGift,
  buildGiftVerdict,
  capitalCounts,
  capitalsFromCounts,
  foldResources,
  normalizeCapital,
  rankByResources,
  resourceBaseOf,
  resourceCount,
} from './resources.js';

const T0 = 1_760_000_000;
const admin = testKey();
const member = testKey();
const seedBank = testKey(); // speaks for "holon_seedbank"
const mallory = testKey();

const actors = () => bootstrapActors({ members: [member.pk], admins: [admin.pk], genesis: admin.pk });
const actsFor = (pk: string, party: string) => pk === seedBank.pk && party === 'holon_seedbank';
const entry = <T extends Record<string, unknown>>(sk: Uint8Array, a: { item: T; refs?: Record<string, string | string[]> }, at: number) =>
  signedEntry<T>({ sk, item: a.item, refs: a.refs as never, created_at: at, lens: 'flow_resources' });
const fold = (entries: unknown[]) => foldResources({ entries: shuffled(entries as never[]), actors: actors(), actsFor });
const gift = (over: Partial<Parameters<typeof buildGift>[0]> = {}) =>
  buildGift({ from: 'holon_seedbank', capital: 'material', amount: 1, unit: 'workspace', at: T0 * 1000, ...over });

describe('the eight capitals', () => {
  it('are the CapitalGame types, financial last', () => {
    expect([...CAPITALS].sort()).toEqual(['cultural', 'experiential', 'financial', 'intellectual', 'living', 'material', 'social', 'spiritual']);
    expect(CAPITALS[CAPITALS.length - 1]).toBe('financial');
    expect(normalizeCapital(' Living ')).toBe('living');
    expect(normalizeCapital('love')).toBeNull();
  });

  it('pack as eight counts and back', () => {
    const counts = capitalCounts({ material: 2, financial: 1 });
    expect(counts).toHaveLength(8);
    expect(capitalsFromCounts(counts)).toEqual({ material: 2, financial: 1 });
    expect(capitalsFromCounts(null)).toEqual({});
    expect(resourceCount({ material: 2, social: 1, financial: 9 })).toBe(3);
  });
});

describe('buildGift', () => {
  it('names giver, capital, amount and unit; stamps the cycle; clips the note', () => {
    const g = gift({ capital: 'Intellectual', amount: 12.345, unit: 'design hours', what: 'design hours', note: 'x'.repeat(900), proof: 'https://example.org/p' });
    expect(g.item).toMatchObject({
      t: 'action',
      kind: 'give',
      from: 'holon_seedbank',
      capital: 'intellectual',
      amount: 12.35,
      unit: 'design hours',
      proof: 'https://example.org/p',
      epoch: lunationAt(T0 * 1000).index,
    });
    expect(g.item.note).toHaveLength(RESOURCE_NOTE_MAX);
  });

  it('refuses a gift with no giver, no known capital, no amount or no unit', () => {
    expect(() => gift({ from: ' ' })).toThrow();
    expect(() => gift({ capital: 'love' })).toThrow();
    expect(() => gift({ amount: 0 })).toThrow();
    expect(() => gift({ unit: '' })).toThrow();
  });
});

describe('foldResources', () => {
  it('anyone may give: the gift is pending, and says whether its signer speaks for the giver', () => {
    const real = entry(seedBank.sk, gift() as never, T0);
    const forged = entry(mallory.sk, gift({ from: 'holon_seedbank', capital: 'living', unit: 'kg seeds' }) as never, T0 + 1);
    const f = fold([real, forged]);
    expect(f.gifts.map((g) => [g.capital, g.status, g.verified])).toEqual([
      ['living', 'pending', false],
      ['material', 'pending', true],
    ]);
    expect(f.base.count).toBe(0);
  });

  it('only a recipient admin receives; then it is in the base', () => {
    const g = entry(seedBank.sk, gift() as never, T0);
    const byMember = entry(member.sk, buildGiftVerdict(g.id, 'attest') as never, T0 + 1);
    expect(fold([g, byMember]).gifts[0].status).toBe('pending');
    const yes = entry(admin.sk, buildGiftVerdict(g.id, 'attest') as never, T0 + 2);
    const f = fold([g, byMember, yes]);
    expect(f.gifts[0]).toMatchObject({ status: 'received', decidedBy: admin.pk, decidedAt: T0 + 2 });
    expect(f.base).toEqual({ count: 1, byCapital: { material: 1 }, amounts: { material: { workspace: 1 } }, givers: 1 });
  });

  it('an admin recording a gift receives it as written', () => {
    const f = fold([entry(admin.sk, gift({ capital: 'social', unit: 'introductions', amount: 3 }) as never, T0)]);
    expect(f.received).toHaveLength(1);
    expect(f.base.byCapital).toEqual({ social: 1 });
  });

  it('a dispute carries its reason and takes the gift out; the latest admin word stands', () => {
    const g = entry(seedBank.sk, gift() as never, T0);
    const yes = entry(admin.sk, buildGiftVerdict(g.id, 'attest') as never, T0 + 1);
    const no = entry(admin.sk, buildGiftVerdict(g.id, 'dispute', 'never arrived') as never, T0 + 2);
    const f = fold([g, yes, no]);
    expect(f.gifts[0]).toMatchObject({ status: 'disputed', reason: 'never arrived' });
    expect(f.base.count).toBe(0);
  });

  it('money is one stream among eight: counted by capital, not in the resource base', () => {
    const cash = entry(admin.sk, gift({ capital: 'financial', amount: 1000, unit: 'EUR' }) as never, T0);
    const tools = entry(admin.sk, gift({ capital: 'material', amount: 1, unit: 'tool library', from: 'holon_tools' }) as never, T0 + 1);
    const f = fold([cash, tools]);
    expect(f.base.count).toBe(1);
    expect(f.base.byCapital).toEqual({ financial: 1, material: 1 });
    expect(f.base.amounts.financial).toEqual({ EUR: 1000 });
    expect(f.base.givers).toBe(2);
  });

  it('drops a malformed gift rather than guessing', () => {
    const bad = entry(admin.sk, { item: { t: 'action', kind: 'give', from: 'x', capital: 'love', amount: 1, unit: 'u', epoch: 0 } } as never, T0);
    expect(fold([bad]).gifts).toEqual([]);
  });
});

describe('resourceBaseOf', () => {
  it('ignores anything not received', () => {
    const base = resourceBaseOf([
      { from: 'a', capital: 'living', amount: 2, unit: 'kg', status: 'received' },
      { from: 'b', capital: 'living', amount: 5, unit: 'kg', status: 'pending' },
    ]);
    expect(base).toEqual({ count: 1, byCapital: { living: 1 }, amounts: { living: { kg: 2 } }, givers: 1 });
  });
});

describe('bandwidthWeights', () => {
  it('divides by resource base, and is empty when nobody has one', () => {
    const w = bandwidthWeights([
      { id: 'a', resources: 3 },
      { id: 'b', resources: 1 },
      { id: 'c' },
    ]);
    expect([...w]).toEqual([
      ['a', 0.75],
      ['b', 0.25],
    ]);
    expect(bandwidthWeights([{ id: 'a' }, { id: 'b', resources: 0 }]).size).toBe(0);
  });
});

describe('rankByResources', () => {
  it('most resourced first, breadth breaks ties, the top two are starred, the empty left out', () => {
    const ranked = rankByResources([
      { id: 'a', label: 'Alder', resources: { material: 2, financial: 5 } },
      { id: 'b', label: 'Birch', resources: { material: 1, living: 1 } },
      { id: 'c', label: 'Cedar', resources: { social: 4 } },
      { id: 'd', label: 'Dogwood', resources: { financial: 9 } },
      { id: 'e', label: 'Elm', resources: { cultural: 1 } },
    ]);
    expect(ranked.map((r) => [r.id, r.count, r.rank, r.star])).toEqual([
      ['c', 4, 1, true],
      ['b', 2, 2, true],
      ['a', 2, 3, false],
      ['e', 1, 4, false],
    ]);
  });

  it('a tie in count and breadth shares the rank', () => {
    const ranked = rankByResources([
      { id: 'a', label: 'A', resources: { material: 1 } },
      { id: 'b', label: 'B', resources: { living: 1 } },
      { id: 'c', label: 'C', resources: { social: 1 } },
    ]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 1]);
    expect(ranked.every((r) => r.star)).toBe(true);
  });
});
