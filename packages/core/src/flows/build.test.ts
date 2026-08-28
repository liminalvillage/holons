import { describe, expect, it } from 'vitest';
import { buildValueFlows, HUB_ID } from './build.js';
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

const build = (over: Partial<Parameters<typeof buildValueFlows>[0]> = {}) =>
  buildValueFlows({
    holonId: 'h1',
    events: [],
    expenses: [],
    now: NOW,
    ...over,
  });

const track = (graph: ReturnType<typeof build>, id: string, unit?: string) =>
  graph.tracks.find((t) => t.id === id && (unit === undefined || t.unit === unit));

describe('buildValueFlows', () => {
  it('returns no tracks for an empty holon', () => {
    expect(build().tracks).toHaveLength(0);
  });

  it('keeps units in separate tracks and never sums across them', () => {
    const graph = build({
      expenses: [expense()],
      events: [
        event({
          id: 'time',
          eventType: 'quest:time_logged',
          resource: { type: 'time', quantity: 4, unit: 'hours' },
          provider: { id: 'ana', type: 'user' },
        }),
        event({
          id: 'kudos',
          eventType: 'appreciation:sent',
          resource: { type: 'appreciation', quantity: 3, unit: 'kudos' },
          provider: { id: 'ben', type: 'user' },
        }),
      ],
    });

    expect(track(graph, 'money', 'eur')).toBeTruthy();
    expect(track(graph, 'time')!.unit).toBe('hours');
    expect(track(graph, 'appreciation')!.unit).toBe('kudos');
    // Three tracks, each with its own totals — nothing merged.
    expect(graph.tracks).toHaveLength(3);
  });

  it('gives each currency its own money track', () => {
    const graph = build({
      expenses: [
        expense({ id: 'a', currency: 'eur', amount: 30 }),
        expense({ id: 'b', currency: 'usd', amount: 60 }),
      ],
    });
    const money = graph.tracks.filter((t) => t.id === 'money');
    expect(money.map((t) => t.unit).sort()).toEqual(['eur', 'usd']);
  });

  it('folds currency casing onto one track', () => {
    const graph = build({
      expenses: [
        expense({ id: 'a', currency: 'EUR' }),
        expense({ id: 'b', currency: 'eur' }),
      ],
    });
    expect(graph.tracks.filter((t) => t.id === 'money')).toHaveLength(1);
  });

  it('does not merge a code with its spelled-out plural', () => {
    // core's `normalizeCurrency` de-pluralizes naively, so 'euros' becomes
    // 'euro' and stays distinct from 'eur'. Pinned because it is surprising and
    // shared with the bot and dashboard — a holon that records both spellings
    // gets two tracks, which is honest rather than silently conflating them.
    const graph = build({
      expenses: [
        expense({ id: 'a', currency: 'eur' }),
        expense({ id: 'b', currency: 'euros' }),
      ],
    });
    expect(graph.tracks.filter((t) => t.id === 'money').map((t) => t.unit).sort()).toEqual([
      'eur',
      'euro',
    ]);
  });

  it('routes the payer in and each sharer out', () => {
    const graph = build({ expenses: [expense()] });
    const money = track(graph, 'money', 'eur')!;

    const paid = money.nodes.find((n) => n.id === 'paid-ana')!;
    expect(paid.depth).toBe(0);
    expect(paid.value).toBe(90);

    // 90 split three ways: ben and cyd each owe 30; ana is the payer.
    const ben = money.nodes.find((n) => n.id === 'owes-ben')!;
    expect(ben.depth).toBe(2);
    expect(ben.value).toBe(30);
    expect(money.nodes.some((n) => n.id === 'owes-ana')).toBe(false);
  });

  it('adds a hub sized to the heavier side', () => {
    const graph = build({ expenses: [expense()] });
    const money = track(graph, 'money', 'eur')!;
    const hub = money.nodes.find((n) => n.id === HUB_ID)!;
    expect(hub.depth).toBe(1);
    expect(hub.value).toBe(Math.max(money.totalIn, money.totalOut));
  });

  it('does not double-count an expense that also exists as REA events', () => {
    // The bot and web both mirror every expense into rea_events. Counting both
    // would double every shared cost.
    const withMirror = build({
      expenses: [expense()],
      events: [
        event({
          id: 'm1',
          eventType: 'expense:paid',
          resource: { type: 'money', quantity: 90, unit: 'eur' },
          provider: { id: 'ana', type: 'user' },
        }),
        event({
          id: 'm2',
          eventType: 'expense:share',
          resource: { type: 'money', quantity: 30, unit: 'eur' },
          receiver: { id: 'ben', type: 'user' },
        }),
      ],
    });
    const withoutMirror = build({ expenses: [expense()] });

    expect(track(withMirror, 'money', 'eur')!.totalIn).toBe(
      track(withoutMirror, 'money', 'eur')!.totalIn,
    );
    expect(track(withMirror, 'money', 'eur')!.totalOut).toBe(
      track(withoutMirror, 'money', 'eur')!.totalOut,
    );
  });

  it('excludes anything outside the window', () => {
    const graph = build({
      windowDays: 30,
      expenses: [
        expense({ id: 'recent' }),
        expense({ id: 'old', created: new Date(NOW - 200 * DAY).toISOString() }),
      ],
    });
    expect(track(graph, 'money', 'eur')!.totalIn).toBe(90);
  });

  it('includes everything for an all-time window', () => {
    const graph = build({
      windowDays: null,
      expenses: [
        expense({ id: 'recent' }),
        expense({ id: 'old', created: new Date(NOW - 900 * DAY).toISOString() }),
      ],
    });
    expect(track(graph, 'money', 'eur')!.totalIn).toBe(180);
    expect(graph.from).toBe(0);
  });

  it('treats a held deposit as owed back, not as income', () => {
    const graph = build({
      events: [
        event({
          eventType: 'item:deposit_held',
          status: 'pending',
          resource: { type: 'credit', quantity: 20, unit: 'credits' },
        }),
      ],
    });
    const money = track(graph, 'money', 'credit')!;
    const held = money.nodes.find((n) => n.id === 'deposits-held')!;
    expect(held.depth).toBe(2);
    expect(money.totalIn).toBe(0);
  });

  it('counts a library fee as income', () => {
    const graph = build({
      events: [
        event({
          eventType: 'item:fee_paid',
          resource: { type: 'credit', quantity: 5, unit: 'credits' },
        }),
      ],
    });
    const money = track(graph, 'money', 'credit')!;
    expect(money.nodes.find((n) => n.id === 'library-fees')!.depth).toBe(0);
    expect(money.totalIn).toBe(5);
  });

  it('splits logged hours with the treasury at the holon’s rate', () => {
    const graph = build({
      settings: { treasuryRate: 0.1 },
      events: [
        event({
          eventType: 'quest:time_logged',
          resource: { type: 'time', quantity: 10, unit: 'hours' },
          provider: { id: 'ana', type: 'user' },
        }),
      ],
    });
    const time = track(graph, 'time')!;
    expect(time.nodes.find((n) => n.id === 'hours-to-treasury')!.value).toBeCloseTo(1, 6);
    expect(time.nodes.find((n) => n.id === 'hours-to-work')!.value).toBeCloseTo(9, 6);
  });

  it('sends all hours to contributors when no treasury rate is set', () => {
    const graph = build({
      events: [
        event({
          eventType: 'quest:time_logged',
          resource: { type: 'time', quantity: 8, unit: 'hours' },
          provider: { id: 'ana', type: 'user' },
        }),
      ],
    });
    const time = track(graph, 'time')!;
    expect(time.nodes.some((n) => n.id === 'hours-to-treasury')).toBe(false);
    expect(time.nodes.find((n) => n.id === 'hours-to-work')!.value).toBe(8);
  });

  it('folds OpenCollective movement onto its currency track', () => {
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
          id: 't1', type: 'CREDIT', kind: 'CONTRIBUTION', amount: 800,
          currency: 'EUR', createdAt: NOW - DAY, description: 'Donation',
        },
        {
          id: 't2', type: 'DEBIT', kind: 'EXPENSE', amount: 200,
          currency: 'EUR', createdAt: NOW - DAY, description: 'Venue',
        },
      ],
    };
    const graph = build({ collective, expenses: [expense()] });
    const money = track(graph, 'money', 'eur')!;

    expect(money.nodes.some((n) => n.kind === 'opencollective' && n.depth === 0)).toBe(true);
    expect(money.nodes.some((n) => n.kind === 'opencollective' && n.depth === 2)).toBe(true);
    // The standing balance rides on the currency it is actually held in.
    expect(money.balance).toBe(1240);
  });

  it('leaves other currencies without a balance', () => {
    const collective: OpenCollectiveSnapshot = {
      slug: 'ours', name: 'Ours', currency: 'EUR', balance: 1240,
      totalReceived: 0, totalSpent: 0, fetchedAt: NOW, transactions: [],
    };
    const graph = build({
      collective,
      expenses: [expense({ currency: 'usd' })],
    });
    expect(track(graph, 'money', 'usd')!.balance).toBeNull();
  });

  it('ignores OpenCollective movement outside the window', () => {
    const collective: OpenCollectiveSnapshot = {
      slug: 'ours', name: 'Ours', currency: 'EUR', balance: 10,
      totalReceived: 0, totalSpent: 0, fetchedAt: NOW,
      transactions: [
        {
          id: 't1', type: 'CREDIT', amount: 500, currency: 'EUR',
          createdAt: NOW - 400 * DAY, description: 'Ancient',
        },
      ],
    };
    const graph = build({ windowDays: 30, collective });
    expect(graph.tracks).toHaveLength(0);
  });

  it('resolves display names when given a resolver', () => {
    const graph = build({
      expenses: [expense()],
      nameOf: (id) => (id === 'ana' ? 'Ana Rossi' : undefined),
    });
    const money = track(graph, 'money', 'eur')!;
    expect(money.nodes.find((n) => n.id === 'paid-ana')!.label).toBe('Ana Rossi');
    // Unresolved ids fall back to the id rather than rendering blank.
    expect(money.nodes.find((n) => n.id === 'owes-ben')!.label).toBe('ben');
  });

  it('labels the treasury rather than showing it as a person', () => {
    const graph = build({
      expenses: [expense({ paidBy: 'treasury', currency: 'hour', amount: 6 })],
    });
    const money = track(graph, 'money', 'hour')!;
    const node = money.nodes.find((n) => n.id === 'paid-treasury')!;
    expect(node.label).toBe('Treasury');
    expect(node.kind).toBe('treasury');
  });

  it('skips expenses with no usable amount', () => {
    const graph = build({
      expenses: [
        expense({ id: 'bad', amount: 0 }),
        expense({ id: 'worse', amount: Number.NaN }),
      ],
    });
    expect(graph.tracks).toHaveLength(0);
  });

  it('reports the window it used', () => {
    const graph = build({ windowDays: 30, expenses: [expense()] });
    expect(graph.to).toBe(NOW);
    expect(graph.from).toBe(NOW - 30 * DAY);
    expect(graph.holonId).toBe('h1');
  });
});
