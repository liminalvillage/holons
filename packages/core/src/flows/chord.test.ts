import { describe, expect, it } from 'vitest';
import {
  CHORD_OTHERS_ID,
  buildPeopleFlows,
  chordBreakdown,
  layoutChord,
  type PeopleFlowTrack,
} from './chord.js';

const NOW = Date.parse('2026-09-14T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

const names: Record<string, string> = { a: 'Ana', b: 'Ben', c: 'Cy' };
const base = {
  holonId: 'h',
  hubLabel: 'Liminal',
  now: NOW,
  windowDays: 90,
  nameOf: (id: string) => names[id],
};

const expense = (over: Record<string, unknown>) =>
  ({
    id: 'e1',
    created: iso(1),
    amount: 30,
    currency: 'eur',
    description: 'food',
    paidBy: 'a',
    splitWith: ['a', 'b', 'c'],
    ...over,
  }) as never;

const event = (over: Record<string, unknown>) =>
  ({
    id: 'x',
    timestamp: NOW - DAY,
    resource: { type: 'money', quantity: 5, unit: 'eur' },
    provider: { id: 'a', type: 'user' },
    receiver: { id: 'b', type: 'user' },
    context: {},
    eventType: 'transfer:direct',
    status: 'confirmed',
    ...over,
  }) as never;

const cell = (track: PeopleFlowTrack, from: string, to: string) => {
  const i = track.parties.findIndex((p) => p.id === from);
  const j = track.parties.findIndex((p) => p.id === to);
  return i < 0 || j < 0 ? 0 : track.matrix[i][j];
};

const find = (tracks: PeopleFlowTrack[], key: string) =>
  tracks.find((t) => `${t.id}:${t.unit}` === key)!;

describe('buildPeopleFlows', () => {
  it('sends an expense from its payer to each other sharer, their share', () => {
    const [money] = buildPeopleFlows({ ...base, events: [], expenses: [expense({})] });
    expect(money.id).toBe('money');
    expect(money.unit).toBe('eur');
    expect(money.parties.map((p) => p.label)).toEqual(['Ana', 'Ben', 'Cy']);
    expect(cell(money, 'a', 'b')).toBe(10);
    expect(cell(money, 'a', 'c')).toBe(10);
    expect(money.total).toBe(20);
    expect(money.parties.find((p) => p.id === 'a')).toMatchObject({ given: 20, received: 0, kind: 'person' });
  });

  it('draws the holon as a party: what is split with it, and what the treasury pays', () => {
    const [money] = buildPeopleFlows({
      ...base,
      events: [],
      expenses: [
        expense({ amount: 220, splitWith: ['h'] }),
        expense({ id: 'e2', amount: 12, paidBy: 'treasury', splitWith: ['b'] }),
      ],
    });
    expect(money.parties[0]).toMatchObject({ id: 'h', label: 'Liminal', kind: 'holon' });
    expect(cell(money, 'a', 'h')).toBe(220);
    expect(cell(money, 'h', 'b')).toBe(12);
  });

  it('keeps external payees out', () => {
    const tracks = buildPeopleFlows({
      ...base,
      expenses: [],
      events: [event({ receiver: { id: 'shop', type: 'external' } })],
    });
    expect(tracks).toEqual([]);
  });

  it('adds direct transfers onto the same currency matrix', () => {
    const [money] = buildPeopleFlows({
      ...base,
      expenses: [expense({})],
      events: [event({ provider: { id: 'b', type: 'user' }, receiver: { id: 'a', type: 'user' } })],
    });
    expect(cell(money, 'b', 'a')).toBe(5);
    expect(money.count).toBe(3);
  });

  it('never mixes units', () => {
    const tracks = buildPeopleFlows({
      ...base,
      expenses: [expense({}), expense({ id: 'e2', currency: 'usd' })],
      events: [
        event({ eventType: 'credit:transfer', resource: { type: 'credit', quantity: 3, unit: 'credits' } }),
        event({ eventType: 'appreciation:sent', resource: { type: 'appreciation', quantity: 2, unit: 'kudos' } }),
      ],
    });
    expect(tracks.map((t) => `${t.id}:${t.unit}`)).toEqual(['money:eur', 'money:usd', 'money:credit', 'appreciation:kudos']);
  });

  it('counts a gift of kudos once, not once per mirror event', () => {
    const kudos = { type: 'appreciation', quantity: 2, unit: 'kudos' };
    const [track] = buildPeopleFlows({
      ...base,
      expenses: [],
      events: [
        event({ id: 's', eventType: 'appreciation:sent', resource: kudos }),
        event({ id: 'r', eventType: 'appreciation:received', resource: kudos }),
      ],
    });
    expect(track.total).toBe(2);
  });

  it('reads quest initiatives and completions as kudos given to the holon', () => {
    const [track] = buildPeopleFlows({
      ...base,
      expenses: [],
      events: [
        event({ eventType: 'quest:initiated', resource: { type: 'appreciation', quantity: 1, unit: 'initiative' }, receiver: { id: 'h', type: 'holon' } }),
        event({ eventType: 'quest:completed', resource: { type: 'appreciation', quantity: 3, unit: 'completion' }, receiver: undefined }),
      ],
    });
    expect(track.id).toBe('appreciation');
    expect(cell(track, 'a', 'h')).toBe(4);
  });

  it('reads logged hours from time-tracking expenses and events, once each', () => {
    const at = NOW - 2 * DAY;
    const tracks = buildPeopleFlows({
      ...base,
      expenses: [
        expense({ id: 't1', created: undefined, timestamp: new Date(at).toISOString(), amount: 2, currency: undefined, unit: 'hour', fromTimeTracking: true, questId: 'q', splitWith: ['h'] }),
      ],
      events: [
        event({ eventType: 'quest:time_logged', timestamp: at, resource: { type: 'time', quantity: 2, unit: 'hours' }, receiver: { id: 'h', type: 'holon' }, context: { questId: 'q' } }),
        event({ id: 'y', eventType: 'quest:time_logged', resource: { type: 'time', quantity: 1, unit: 'hours' }, provider: { id: 'b', type: 'user' }, receiver: undefined }),
      ],
    });
    const time = find(tracks, 'time:hours');
    expect(cell(time, 'a', 'h')).toBe(2);
    expect(cell(time, 'b', 'h')).toBe(1);
    expect(tracks.some((t) => t.id === 'money')).toBe(false);
  });

  it('keeps two time-tracking records apart, however close together', () => {
    const at = NOW - 2 * DAY;
    const logged = (id: string, offset: number) =>
      expense({ id, created: undefined, timestamp: new Date(at + offset).toISOString(), amount: 2, currency: undefined, unit: 'hour', fromTimeTracking: true, questId: 'q', splitWith: ['h'] });
    const [time] = buildPeopleFlows({ ...base, events: [], expenses: [logged('t1', 0), logged('t2', 5_000)] });
    expect(cell(time, 'a', 'h')).toBe(4);
  });

  it('moves stock in its own unit, and lends items from owner to borrower', () => {
    const tracks = buildPeopleFlows({
      ...base,
      expenses: [],
      events: [
        event({ eventType: 'stock:produced', resource: { type: 'item', quantity: 4, unit: 'kg' }, receiver: { id: 'h', type: 'holon' } }),
        event({ eventType: 'stock:consumed', resource: { type: 'item', quantity: 1, unit: 'kg' }, provider: { id: 'h', type: 'holon' } }),
        event({ eventType: 'item:borrowed', resource: { type: 'item', quantity: 1, unit: 'drill' } }),
        event({ eventType: 'item:deposit_held', resource: { type: 'credit', quantity: 9, unit: 'credits' }, receiver: { id: 'h', type: 'holon' } }),
      ],
    });
    const kg = find(tracks, 'items:kg');
    expect(cell(kg, 'a', 'h')).toBe(4);
    expect(cell(kg, 'h', 'b')).toBe(1);
    expect(cell(find(tracks, 'items:lends'), 'a', 'b')).toBe(1);
    expect(cell(find(tracks, 'money:credit'), 'a', 'h')).toBe(9);
  });

  it('reads only the window', () => {
    const tracks = buildPeopleFlows({
      ...base,
      expenses: [expense({ created: iso(120) })],
      events: [event({ timestamp: NOW - 200 * DAY })],
    });
    expect(tracks).toEqual([]);
    expect(buildPeopleFlows({ ...base, windowDays: null, expenses: [expense({ created: iso(120) })], events: [] })).toHaveLength(1);
  });

  it('narrows to the flows one person is part of', () => {
    const [money] = buildPeopleFlows({ ...base, involving: 'b', expenses: [expense({})], events: [] });
    expect(money.parties.map((p) => p.id)).toEqual(['a', 'b']);
    expect(money.total).toBe(10);
  });
});

const track = (ids: string[], flows: [string, string, number][], holons: string[] = []): PeopleFlowTrack => {
  const index = new Map(ids.map((id, i) => [id, i]));
  const matrix = ids.map(() => ids.map(() => 0));
  for (const [f, t, v] of flows) matrix[index.get(f)!][index.get(t)!] += v;
  return {
    id: 'money',
    unit: 'eur',
    parties: ids.map((id, i) => ({
      id,
      label: id.toUpperCase(),
      kind: holons.includes(id) ? ('holon' as const) : ('person' as const),
      given: matrix[i].reduce((s, v) => s + v, 0),
      received: matrix.reduce((s, row) => s + row[i], 0),
    })),
    matrix,
    total: flows.reduce((s, [, , v]) => s + v, 0),
    count: flows.length,
  };
};

describe('layoutChord', () => {
  const t = track(['a', 'b', 'c'], [
    ['a', 'b', 30],
    ['b', 'a', 10],
    ['c', 'a', 20],
  ]);

  it('gives each party an arc as long as what they gave and received', () => {
    const layout = layoutChord(t, { innerRadius: 100 });
    expect(layout.empty).toBe(false);
    expect(layout.outerRadius).toBe(108);
    const span = (id: string) => {
      const g = layout.groups.find((x) => x.id === id)!;
      return g.endAngle - g.startAngle;
    };
    expect(span('a') / span('c')).toBeCloseTo(3, 6);
    expect(span('b') / span('c')).toBeCloseTo(2, 6);
    const last = layout.groups[layout.groups.length - 1];
    expect(last.endAngle + 10 / 100).toBeCloseTo(Math.PI * 2, 6);
  });

  it('draws one ribbon per direction, largest first', () => {
    const layout = layoutChord(t, { innerRadius: 100 });
    expect(layout.ribbons.map((r) => r.id)).toEqual(['a>b', 'c>a', 'b>a']);
    for (const ribbon of layout.ribbons) {
      expect(ribbon.path.startsWith('M')).toBe(true);
      expect(ribbon.path.endsWith('Z')).toBe(true);
      expect(ribbon.path).toContain('Q0,0,');
    }
  });

  it('is deterministic', () => {
    expect(layoutChord(t, { innerRadius: 80 })).toEqual(layoutChord(t, { innerRadius: 80 }));
  });

  it('flips labels on the left half so they read outward', () => {
    const layout = layoutChord(t, { innerRadius: 100 });
    for (const g of layout.groups) {
      const mid = (g.startAngle + g.endAngle) / 2;
      expect(g.labelAnchor).toBe(mid > Math.PI ? 'end' : 'start');
    }
  });

  it('marks holons, and never rolls one into the others', () => {
    const ids = ['h', 'a', 'b', 'c', 'd'];
    const big = track(
      ids,
      [
        ['a', 'b', 50],
        ['c', 'a', 40],
        ['d', 'h', 1],
        ['b', 'c', 7],
      ],
      ['h'],
    );
    const layout = layoutChord(big, { innerRadius: 100, topN: 3, othersLabel: 'More' });
    expect(layout.groups.map((g) => g.id)).toEqual(['h', 'a', CHORD_OTHERS_ID]);
    expect(layout.groups[0].kind).toBe('holon');
    const others = layout.groups.find((g) => g.id === CHORD_OTHERS_ID)!;
    expect(others.label).toBe('More (3)');
    expect(others.kind).toBe('other');
    // b, c and d are others now: c→a 40 + d→h 1; b→c is inside it.
    expect(chordBreakdown(layout, CHORD_OTHERS_ID).given).toEqual([
      { id: 'a', label: 'A', value: 40 },
      { id: 'h', label: 'H', value: 1 },
    ]);
  });

  it('is empty with nothing to draw', () => {
    expect(layoutChord(null, { innerRadius: 100 }).empty).toBe(true);
    expect(layoutChord(track(['a'], []), { innerRadius: 100 }).empty).toBe(true);
  });
});

describe('chordBreakdown', () => {
  it('lists who a party gave to and received from', () => {
    const layout = layoutChord(
      track(['a', 'b', 'c'], [
        ['a', 'b', 30],
        ['a', 'c', 5],
        ['c', 'a', 20],
      ]),
      { innerRadius: 100 },
    );
    expect(chordBreakdown(layout, 'a')).toEqual({
      given: [
        { id: 'b', label: 'B', value: 30 },
        { id: 'c', label: 'C', value: 5 },
      ],
      received: [{ id: 'c', label: 'C', value: 20 }],
    });
  });
});
