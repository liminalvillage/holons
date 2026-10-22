import { describe, expect, it } from 'vitest';
import { combinePeopleTracks, combineTracks } from './combine.js';
import type { ValueFlowTrack } from './types.js';
import type { PeopleFlowTrack } from './chord.js';

const opts = {
  labelOf: (t: { id: string; unit: string }) => t.unit.toUpperCase(),
  formatOf: (t: { id: string; unit: string }) => (v: number) =>
    `${v}${t.unit === 'eur' ? '€' : ''}`,
};

function track(unit: string, value: number): ValueFlowTrack {
  return {
    id: 'money',
    unit,
    nodes: [
      { id: 'a', label: 'A', depth: 0, value },
      { id: 'hub', label: 'Hub', depth: 1, value },
    ],
    links: [{ id: 'l', source: 'a', target: 'hub', value }],
    totalIn: value,
    totalOut: 0,
    balance: null,
  };
}

describe('combineTracks', () => {
  it('leaves a single track alone — shares would only hide real amounts', () => {
    const one = track('eur', 50);
    expect(combineTracks([one], opts)).toBe(one);
    expect(combineTracks([], opts)).toBeNull();
  });

  it('never sums amounts across units: each track is scaled to its own total', () => {
    // 1000 euro and 4 kilograms must weigh the same, because each is all of
    // its own unit's flow. Summing 1000 + 4 would make the kilograms invisible.
    const combined = combineTracks([track('eur', 1000), track('kg', 4)], opts)!;
    expect(combined.id).toBe('combined');
    for (const link of combined.links) expect(link.value).toBeCloseTo(100, 8);
    expect(combined.nodes.find((n) => n.id === 'a')!.value).toBeCloseTo(200, 8);
  });

  it('gives each unit its own ribbon between the same pair', () => {
    const combined = combineTracks([track('eur', 1000), track('kg', 4)], opts)!;
    const between = combined.links.filter(
      (l) => l.source === 'a' && l.target === 'hub',
    );
    expect(between.map((l) => [l.unit, l.display])).toEqual([
      ['EUR', '1000€ EUR'],
      ['KG', '4 KG'],
    ]);
  });

  it('keeps the real amounts on display, per unit', () => {
    const combined = combineTracks([track('eur', 1000), track('kg', 4)], opts)!;
    const node = combined.nodes.find((n) => n.id === 'a')!;
    expect(node.display).toBe('1000€ EUR · 4 KG');
    expect(node.segments?.map((s) => [s.unit, s.display])).toEqual([
      ['EUR', '1000€ EUR'],
      ['KG', '4 KG'],
    ]);
  });

  it('does not name a unit the formatted amount already names', () => {
    // "4 kg" must not become "4 kg KG", while "€106" still needs its code.
    const spelled = {
      labelOf: (t: { unit: string }) => t.unit,
      formatOf: (t: { unit: string }) => (v: number) => `${v} ${t.unit}`,
    };
    const combined = combineTracks([track('kg', 4), track('lends', 2)], spelled)!;
    expect(combined.links.map((l) => l.display)).toEqual(['4 kg', '2 lends']);
  });

  it('adds up two flows of the SAME unit between one pair', () => {
    const twice = track('eur', 10);
    twice.links = [
      { id: 'l1', source: 'a', target: 'hub', value: 4 },
      { id: 'l2', source: 'a', target: 'hub', value: 6 },
    ];
    const combined = combineTracks([twice, track('usd', 20)], opts)!;
    const eur = combined.links.filter((l) => l.unit === 'EUR');
    expect(eur).toHaveLength(1);
    expect(eur[0].display).toBe('10€ EUR');
    expect(eur[0].value).toBeCloseTo(100, 8);
    expect(combined.links).toHaveLength(2); // one per unit
    expect(combined.nodes).toHaveLength(2);
  });

  it('a track that moved nothing contributes nothing', () => {
    const empty = { ...track('kg', 0), links: [], totalIn: 0 };
    const combined = combineTracks([track('eur', 10), empty], opts);
    expect(combined).toBe(combined); // single usable track returns as-is
    expect(combined!.unit).toBe('eur');
  });
});

function people(unit: string, value: number): PeopleFlowTrack {
  return {
    id: 'money',
    unit,
    parties: [
      { id: 'ada', label: 'Ada', kind: 'person', given: value, received: 0 },
      { id: 'bob', label: 'Bob', kind: 'person', given: 0, received: value },
    ],
    matrix: [
      [0, value],
      [0, 0],
    ],
    total: value,
    count: 1,
  };
}

describe('combinePeopleTracks', () => {
  it('unions the parties and adds shares, not amounts', () => {
    // 900 euro and 3 kilograms weigh the same, and the result is rescaled to
    // itself so the numbers read as shares of everything that moved.
    const combined = combinePeopleTracks([people('eur', 900), people('kg', 3)], opts)!;
    expect(combined.parties.map((p) => p.id)).toEqual(['ada', 'bob']);
    expect(combined.total).toBeCloseTo(100, 8);
    expect(combined.matrix[0][1]).toBeCloseTo(100, 8);
    expect(combined.parties[0].given).toBeCloseTo(100, 8);
    expect(combined.parties[1].received).toBeCloseTo(100, 8);
    expect(combined.count).toBe(2);
  });

  it('shares over the whole chord sum to 100', () => {
    const other = people('kg', 5);
    other.parties[1] = { id: 'cy', label: 'Cy', kind: 'person', given: 0, received: 5 };
    const combined = combinePeopleTracks([people('eur', 10), other], opts)!;
    const sum = combined.matrix.flat().reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(100, 8);
  });

  it('keeps a party that only one track knows', () => {
    const other = people('kg', 5);
    other.parties[1] = { id: 'cy', label: 'Cy', kind: 'person', given: 0, received: 5 };
    const combined = combinePeopleTracks([people('eur', 10), other], opts)!;
    expect(combined.parties.map((p) => p.id)).toEqual(['ada', 'bob', 'cy']);
    expect(combined.matrix[0][2]).toBeCloseTo(50, 8);
  });

  it('opens each party up unit by unit', () => {
    // The percentages a combined chord shows have to be explainable: Ada gave
    // all of the euro and all of the kilograms, and the popup must say so in
    // real amounts, not only as a share.
    const combined = combinePeopleTracks([people('eur', 900), people('kg', 3)], opts)!;
    const [ada, bob] = combined.parties;
    expect(ada.givenUnits).toEqual([
      { unit: 'EUR', share: 100, amount: 900, display: '900€ EUR' },
      { unit: 'KG', share: 100, amount: 3, display: '3 KG' },
    ]);
    expect(ada.receivedUnits).toBeUndefined();
    expect(bob.receivedUnits?.map((u) => u.display)).toEqual(['900€ EUR', '3 KG']);
    expect(bob.givenUnits).toBeUndefined();
  });

  it('records what each pair moved, unit by unit', () => {
    const combined = combinePeopleTracks([people('eur', 900), people('kg', 3)], opts)!;
    expect(combined.unitsByPair?.['ada>bob']).toEqual([
      { unit: 'EUR', share: 100, amount: 900, display: '900€ EUR' },
      { unit: 'KG', share: 100, amount: 3, display: '3 KG' },
    ]);
    expect(combined.unitsByPair?.['bob>ada']).toBeUndefined();
  });

  it('leaves a unit-coherent track without a breakdown — it is one unit', () => {
    const one = people('eur', 5);
    expect(combinePeopleTracks([one], opts)!.parties[0].givenUnits).toBeUndefined();
  });

  it('returns a lone track untouched and null for nothing', () => {
    const one = people('eur', 5);
    expect(combinePeopleTracks([one], opts)).toBe(one);
    expect(combinePeopleTracks([], opts)).toBeNull();
  });
});
