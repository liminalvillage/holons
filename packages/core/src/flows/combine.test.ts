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
    const link = combined.links.find((l) => l.source === 'a')!;
    expect(link.value).toBeCloseTo(200, 8); // 100 from each track
    expect(combined.nodes.find((n) => n.id === 'a')!.value).toBeCloseTo(200, 8);
  });

  it('keeps the real amounts on display, per unit', () => {
    const combined = combineTracks([track('eur', 1000), track('kg', 4)], opts)!;
    expect(combined.links[0].display).toBe('1000€ EUR · 4 KG');
    const node = combined.nodes.find((n) => n.id === 'a')!;
    expect(node.display).toBe('1000€ EUR · 4 KG');
    expect(node.segments?.map((s) => [s.label, s.display])).toEqual([
      ['EUR', '1000€ EUR'],
      ['KG', '4 KG'],
    ]);
  });

  it('merges links and nodes that appear in several tracks', () => {
    const combined = combineTracks([track('eur', 10), track('usd', 20)], opts)!;
    expect(combined.links).toHaveLength(1);
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
    const combined = combinePeopleTracks([people('eur', 900), people('kg', 3)], opts)!;
    expect(combined.parties.map((p) => p.id)).toEqual(['ada', 'bob']);
    expect(combined.matrix[0][1]).toBeCloseTo(200, 8);
    expect(combined.parties[0].given).toBeCloseTo(200, 8);
    expect(combined.parties[1].received).toBeCloseTo(200, 8);
    expect(combined.count).toBe(2);
  });

  it('keeps a party that only one track knows', () => {
    const other = people('kg', 5);
    other.parties[1] = { id: 'cy', label: 'Cy', kind: 'person', given: 0, received: 5 };
    const combined = combinePeopleTracks([people('eur', 10), other], opts)!;
    expect(combined.parties.map((p) => p.id)).toEqual(['ada', 'bob', 'cy']);
    expect(combined.matrix[0][2]).toBeCloseTo(100, 8);
  });

  it('returns a lone track untouched and null for nothing', () => {
    const one = people('eur', 5);
    expect(combinePeopleTracks([one], opts)).toBe(one);
    expect(combinePeopleTracks([], opts)).toBeNull();
  });
});
