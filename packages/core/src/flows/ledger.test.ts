import { describe, expect, it } from 'vitest';
import { buildValueFlows, HUB_ID } from './build.js';
import {
  buildLedger,
  filterLedger,
  foldForSearch,
  ledgerSearchText,
  ledgerTrackKey,
  sortLedger,
  summarizeLedger,
} from './ledger.js';
import type { REAEvent } from '../rea/index.js';
import type { Expense } from '../expenses/index.js';
import type { OpenCollectiveSnapshot } from './opencollective.js';

const NOW = Date.parse('2026-06-01T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

const expense = (over: Partial<Expense> = {}): Expense => ({
  id: 'e1',
  created: new Date(NOW - DAY).toISOString(),
  amount: 90,
  currency: 'eur',
  description: 'Groceries',
  paidBy: 'ana',
  splitWith: ['ana', 'ben', 'cyd'],
  ...over,
});

const event = (over: Partial<REAEvent> = {}): REAEvent => ({
  id: 'r1',
  timestamp: NOW - DAY,
  ...over,
});

const collective: OpenCollectiveSnapshot = {
  slug: 'ours',
  name: 'Ours',
  currency: 'EUR',
  balance: 1240,
  totalReceived: 800,
  totalSpent: 200,
  fetchedAt: NOW,
  transactions: [
    {
      id: 't1',
      type: 'CREDIT',
      kind: 'CONTRIBUTION',
      amount: 800,
      currency: 'EUR',
      createdAt: NOW - DAY,
      description: 'Yearly donation',
      fromAccount: 'Fondazione Verde',
    },
    {
      id: 't2',
      type: 'DEBIT',
      kind: 'EXPENSE',
      amount: 200,
      currency: 'EUR',
      createdAt: NOW - DAY,
      description: 'Venue hire',
      toAccount: 'Sala Civica',
    },
  ],
};

const ledger = (over: Partial<Parameters<typeof buildLedger>[0]> = {}) =>
  buildLedger({ holonId: 'h1', events: [], expenses: [], now: NOW, ...over });

describe('buildLedger', () => {
  it('has nothing to show for an empty holon', () => {
    expect(ledger().entries).toHaveLength(0);
  });

  it('names the payer and every sharer on an expense row', () => {
    const { entries } = ledger({
      expenses: [expense()],
      nameOf: (id) => ({ ana: 'Ana Rossi', ben: 'Ben Ilic' })[id],
    });

    const paid = entries.find((e) => e.direction === 'in')!;
    expect(paid.party).toBe('Ana Rossi');
    expect(paid.amount).toBe(90);
    expect(paid.description).toBe('Groceries');
    expect(paid.reference).toBe('e1');
    // Unresolved ids fall back to the id rather than rendering blank.
    expect(paid.participants).toEqual(['Ana Rossi', 'Ben Ilic', 'cyd']);

    const owed = entries.filter((e) => e.direction === 'out');
    expect(owed.map((e) => e.party)).toEqual(['Ben Ilic', 'cyd']);
    expect(owed.every((e) => e.amount === 30)).toBe(true);
  });

  it('gives every row a unique id', () => {
    const { entries } = ledger({
      expenses: [expense(), expense({ id: 'e2', description: 'Fuel' })],
      events: [
        event({
          eventType: 'appreciation:sent',
          resource: { type: 'appreciation', quantity: 3, unit: 'kudos' },
          provider: { id: 'ben' },
        }),
      ],
      collective,
    });
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
  });

  it('carries the OpenCollective counterparty and description', () => {
    const { entries } = ledger({ collective });
    const donation = entries.find((e) => e.direction === 'in')!;
    expect(donation.party).toBe('Fondazione Verde');
    expect(donation.description).toBe('Yearly donation');
    expect(donation.source).toBe('opencollective');

    const venue = entries.find((e) => e.direction === 'out')!;
    expect(venue.party).toBe('Sala Civica');
  });

  it('marks the treasury split as derived rather than recorded', () => {
    const { entries } = ledger({
      settings: { treasuryRate: 0.1 },
      events: [
        event({
          eventType: 'quest:time_logged',
          resource: { type: 'time', quantity: 10, unit: 'hours' },
          provider: { id: 'ana' },
        }),
      ],
    });

    const logged = entries.find((e) => e.direction === 'in')!;
    expect(logged.source).toBe('rea');
    expect(logged.derived).toBeUndefined();

    const treasury = entries.find((e) => e.nodeId === 'hours-to-treasury')!;
    expect(treasury.derived).toBe(true);
    expect(treasury.source).toBe('derived');
    expect(treasury.amount).toBeCloseTo(1, 6);
  });

  it('excludes anything outside the window', () => {
    const { entries, from, to } = ledger({
      windowDays: 30,
      expenses: [
        expense({ id: 'recent' }),
        expense({ id: 'old', created: new Date(NOW - 200 * DAY).toISOString() }),
      ],
    });
    expect(entries.every((e) => e.reference === 'recent')).toBe(true);
    expect(from).toBe(NOW - 30 * DAY);
    expect(to).toBe(NOW);
  });

  it('does not double-count an expense that also exists as REA events', () => {
    const { entries } = ledger({
      expenses: [expense()],
      events: [
        event({
          id: 'm1',
          eventType: 'expense:paid',
          resource: { type: 'money', quantity: 90, unit: 'eur' },
          provider: { id: 'ana' },
        }),
      ],
    });
    expect(entries.filter((e) => e.direction === 'in')).toHaveLength(1);
  });

  it('keeps every row in exactly one unit', () => {
    const { entries } = ledger({
      expenses: [expense({ currency: 'usd', amount: 20, splitWith: ['ana', 'ben'] })],
      events: [
        event({
          id: 'h',
          eventType: 'quest:time_logged',
          resource: { type: 'time', quantity: 4, unit: 'hours' },
          provider: { id: 'ana' },
        }),
      ],
    });
    const keys = new Set(entries.map(ledgerTrackKey));
    expect([...keys].sort()).toEqual(['money:usd', 'time:hours']);
  });
});

describe('the ledger and the diagram agree', () => {
  // The anti-drift guard: `buildValueFlows` groups these very rows, so every
  // node in the diagram must be exactly the sum of the rows behind it. If the
  // two ever get separate walkers again, this fails.
  it('sums each node out of the rows behind it', () => {
    const input = {
      holonId: 'h1',
      now: NOW,
      settings: { treasuryRate: 0.1 },
      expenses: [expense(), expense({ id: 'e2', currency: 'usd', amount: 40, paidBy: 'ben' })],
      collective,
      events: [
        event({
          id: 'fee',
          eventType: 'item:fee_paid',
          resource: { type: 'credit', quantity: 5, unit: 'credits' },
        }),
        event({
          id: 'hours',
          eventType: 'quest:time_logged',
          resource: { type: 'time', quantity: 10, unit: 'hours' },
          provider: { id: 'ana' },
        }),
        event({
          id: 'kudos',
          eventType: 'appreciation:sent',
          resource: { type: 'appreciation', quantity: 3, unit: 'kudos' },
          provider: { id: 'ben' },
        }),
      ],
    };

    const graph = buildValueFlows(input);
    const { entries } = buildLedger(input);
    expect(graph.tracks.length).toBeGreaterThan(1);

    for (const track of graph.tracks) {
      const rows = entries.filter((e) => ledgerTrackKey(e) === `${track.id}:${track.unit}`);
      for (const node of track.nodes) {
        if (node.id === HUB_ID) continue;
        const sum = rows
          .filter((e) => e.nodeId === node.id)
          .reduce((total, e) => total + e.amount, 0);
        expect(sum).toBeCloseTo(node.value, 6);
      }
      const rowsIn = rows.filter((e) => e.direction === 'in').reduce((s, e) => s + e.amount, 0);
      expect(rowsIn).toBeCloseTo(track.totalIn, 6);
    }
  });
});

describe('ledger ids are unique', () => {
	it('suffixes colliding rows instead of handing UIs duplicate keys', () => {
		const expense = {
			id: undefined,
			amount: 30,
			currency: 'EUR',
			paidBy: 'alice',
			splitWith: ['bob', 'bob', 'carol'],
			created: new Date(NOW - 1000).toISOString(),
		} as unknown as Expense;
		const { entries } = buildLedger({ expenses: [expense, expense], now: NOW });
		const ids = entries.map((e) => e.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(entries.length).toBe(8);
	});
});

describe('filterLedger', () => {
  const entries = ledger({
    expenses: [
      expense({ id: 'e1', description: 'Venue hire', paidBy: 'ana' }),
      expense({ id: 'e2', description: 'Seeds', paidBy: 'ben', amount: 30 }),
    ],
    collective,
    nameOf: (id) => ({ ana: 'Ana Rossi', ben: 'Bénédicte' })[id],
  }).entries;

  it('returns everything for an empty filter', () => {
    expect(filterLedger(entries)).toHaveLength(entries.length);
  });

  it('finds rows by a person’s name', () => {
    const hits = filterLedger(entries, { query: 'ana' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((e) => ledgerSearchText(e).includes('ana'))).toBe(true);
  });

  it('ignores accents, so a name is searchable as typed', () => {
    expect(foldForSearch('Bénédicte')).toBe('benedicte');
    expect(filterLedger(entries, { query: 'benedicte' }).length).toBeGreaterThan(0);
  });

  it('ANDs the words, rather than widening with each one', () => {
    const both = filterLedger(entries, { query: 'ana venue' });
    const one = filterLedger(entries, { query: 'ana' });
    expect(both.length).toBeGreaterThan(0);
    expect(both.length).toBeLessThan(one.length + filterLedger(entries, { query: 'venue' }).length);
    expect(both.every((e) => e.description === 'Venue hire')).toBe(true);
  });

  it('finds nothing for a term nobody wrote', () => {
    expect(filterLedger(entries, { query: 'helicopter' })).toHaveLength(0);
  });

  it('narrows to one direction', () => {
    expect(filterLedger(entries, { direction: 'in' }).every((e) => e.direction === 'in')).toBe(true);
  });

  it('narrows to the rows behind one diagram node', () => {
    const hits = filterLedger(entries, { nodeId: 'paid-ana' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((e) => e.nodeId === 'paid-ana')).toBe(true);
  });

  it('narrows to one source', () => {
    const hits = filterLedger(entries, { source: 'opencollective' });
    expect(hits.length).toBe(2);
  });

  it('combines a search with the other filters', () => {
    const hits = filterLedger(entries, { query: 'seeds', direction: 'out' });
    expect(hits.every((e) => e.direction === 'out' && e.description === 'Seeds')).toBe(true);
  });
});

describe('sortLedger', () => {
  it('puts the newest first and never shuffles equal timestamps', () => {
    const { entries } = ledger({
      expenses: [
        expense({ id: 'older', created: new Date(NOW - 5 * DAY).toISOString() }),
        expense({ id: 'newer', created: new Date(NOW - DAY).toISOString() }),
      ],
    });
    const sorted = sortLedger(entries);
    expect(sorted[0].reference).toBe('newer');
    expect(sortLedger(entries).map((e) => e.id)).toEqual(sorted.map((e) => e.id));
    expect(sortLedger(entries, false)[0].reference).toBe('older');
  });
});

describe('summarizeLedger', () => {
  it('totals each unit on its own and never sums across them', () => {
    const { entries } = ledger({
      expenses: [expense({ splitWith: ['ana', 'ben'] })],
      events: [
        event({
          id: 'hours',
          eventType: 'quest:time_logged',
          resource: { type: 'time', quantity: 4, unit: 'hours' },
          provider: { id: 'ana' },
        }),
      ],
    });

    const totals = summarizeLedger(entries);
    const money = totals.find((t) => t.key === 'money:eur')!;
    expect(money.totalIn).toBe(90);
    expect(money.totalOut).toBe(45);
    expect(money.net).toBe(45);
    expect(money.count).toBe(2);

    const time = totals.find((t) => t.key === 'time:hours')!;
    expect(time.totalIn).toBe(4);
    // Two separate rows, two separate units — nothing merged into one number.
    expect(totals).toHaveLength(2);
  });

  it('totals nothing for an empty set', () => {
    expect(summarizeLedger([])).toEqual([]);
  });
});
