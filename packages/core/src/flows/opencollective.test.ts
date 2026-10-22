import { describe, expect, it } from 'vitest';
import {
  COLLECTIVE_OVERVIEW_QUERY,
  OPEN_EXPENSE_STATUSES,
  isValidCollectiveSlug,
  normalizeCollectiveSlug,
  parseOpenCollectiveResponse,
} from './opencollective.js';

const NOW = Date.parse('2026-06-01T12:00:00.000Z');

const response = {
  data: {
    account: {
      slug: 'our-collective',
      name: 'Our Collective',
      currency: 'EUR',
      stats: { balance: { value: 1240.5, currency: 'EUR' } },
    },
    transactions: {
      nodes: [
        {
          id: 'tx1',
          type: 'CREDIT',
          kind: 'CONTRIBUTION',
          createdAt: '2026-05-20T09:00:00.000Z',
          description: 'Monthly donation',
          amount: { value: 100, currency: 'EUR' },
          fromAccount: { slug: 'ada', name: 'Ada' },
          toAccount: { slug: 'our-collective', name: 'Our Collective' },
        },
        {
          id: 'tx2',
          type: 'DEBIT',
          kind: 'EXPENSE',
          createdAt: '2026-05-22T09:00:00.000Z',
          description: 'Venue hire',
          amount: { value: -40, currency: 'EUR' },
          toAccount: { slug: 'hall', name: 'Hall' },
        },
      ],
    },
    openExpenses: {
      nodes: [
        {
          id: 'ex_open',
          status: 'PENDING',
          type: 'RECEIPT',
          createdAt: '2026-05-25T09:00:00.000Z',
          description: 'Train tickets',
          amountV2: { value: 60, currency: 'EUR' },
          payee: { slug: 'ada', name: 'Ada' },
        },
        {
          // Reached us through the open branch but was dropped since: never
          // touched the fund, must not be counted.
          id: 'ex_gone',
          status: 'REJECTED',
          createdAt: '2026-05-26T09:00:00.000Z',
          description: 'Nope',
          amountV2: { value: 999, currency: 'EUR' },
          payee: { slug: 'ada', name: 'Ada' },
        },
      ],
    },
    paidExpenses: {
      nodes: [
        {
          id: 'ex_paid',
          status: 'PAID',
          type: 'INVOICE',
          createdAt: '2026-05-22T09:00:00.000Z',
          description: 'Venue hire',
          amountV2: { value: 40, currency: 'EUR' },
          payee: { slug: 'hall', name: 'Hall' },
        },
        {
          id: 'ex_usd',
          status: 'PAID',
          createdAt: '2026-05-23T09:00:00.000Z',
          description: 'Dollars',
          amountV2: { value: 12.5, currency: 'USD' },
          payee: { slug: 'bob' },
        },
      ],
    },
  },
};

describe('normalizeCollectiveSlug', () => {
  it('passes a bare slug through', () => {
    expect(normalizeCollectiveSlug('our-collective')).toBe('our-collective');
  });

  it('reduces a pasted URL to its slug', () => {
    expect(normalizeCollectiveSlug('https://opencollective.com/our-collective')).toBe(
      'our-collective',
    );
    expect(normalizeCollectiveSlug('opencollective.com/our-collective/')).toBe(
      'our-collective',
    );
  });

  it('lowercases and strips anything unexpected', () => {
    expect(normalizeCollectiveSlug('  Our_Collective! ')).toBe('ourcollective');
  });

  it('is empty for empty input', () => {
    expect(normalizeCollectiveSlug('')).toBe('');
    expect(normalizeCollectiveSlug(null)).toBe('');
  });
});

describe('isValidCollectiveSlug', () => {
  it('accepts real slugs and rejects injection attempts', () => {
    expect(isValidCollectiveSlug('our-collective')).toBe(true);
    expect(isValidCollectiveSlug('')).toBe(false);
    expect(isValidCollectiveSlug('-leading')).toBe(false);
    expect(isValidCollectiveSlug('has space')).toBe(false);
    expect(isValidCollectiveSlug('a"})]')).toBe(false);
  });
});

describe('COLLECTIVE_OVERVIEW_QUERY', () => {
  it('parameterizes the slug rather than interpolating it', () => {
    expect(COLLECTIVE_OVERVIEW_QUERY).toContain('$slug: String!');
    expect(COLLECTIVE_OVERVIEW_QUERY).not.toContain('${');
  });

  it('asks for the open and the paid expense queues by status', () => {
    expect(COLLECTIVE_OVERVIEW_QUERY).toContain('openExpenses: expenses(');
    expect(COLLECTIVE_OVERVIEW_QUERY).toContain('paidExpenses: expenses(');
    expect(COLLECTIVE_OVERVIEW_QUERY).toContain('status: [PAID]');
    for (const status of OPEN_EXPENSE_STATUSES) {
      expect(COLLECTIVE_OVERVIEW_QUERY).toContain(status);
    }
    expect(COLLECTIVE_OVERVIEW_QUERY).toContain('payee {');
  });
});

describe('parseOpenCollectiveResponse', () => {
  const snapshot = parseOpenCollectiveResponse(response, 'our-collective', NOW);

  it('reads the account and balance', () => {
    expect(snapshot.slug).toBe('our-collective');
    expect(snapshot.name).toBe('Our Collective');
    expect(snapshot.currency).toBe('EUR');
    expect(snapshot.balance).toBe(1240.5);
    expect(snapshot.fetchedAt).toBe(NOW);
  });

  it('splits credits from debits and totals each side', () => {
    expect(snapshot.totalReceived).toBe(100);
    expect(snapshot.totalSpent).toBe(40);
  });

  it('normalizes a debit’s sign away, keeping direction in the type', () => {
    // OpenCollective is not consistent about the sign on `amount`, so the
    // magnitude is what gets stored and `type` carries the direction.
    const debit = snapshot.transactions.find((t) => t.id === 'tx2')!;
    expect(debit.type).toBe('DEBIT');
    expect(debit.amount).toBe(40);
  });

  it('converts timestamps to ms epoch', () => {
    expect(snapshot.transactions[0].createdAt).toBe(
      Date.parse('2026-05-20T09:00:00.000Z'),
    );
  });

  it('carries account names through', () => {
    expect(snapshot.transactions[0].fromAccount).toBe('Ada');
    expect(snapshot.transactions[1].toAccount).toBe('Hall');
  });

  it('accepts the payload with or without its data envelope', () => {
    const unwrapped = parseOpenCollectiveResponse(response.data, 'our-collective', NOW);
    expect(unwrapped.balance).toBe(1240.5);
    expect(unwrapped.transactions).toHaveLength(2);
  });

  it('reads valueInCents when value is absent', () => {
    const cents = parseOpenCollectiveResponse(
      { data: { account: { stats: { balance: { valueInCents: 5000, currency: 'EUR' } } } } },
      'x',
      NOW,
    );
    expect(cents.balance).toBe(50);
  });

  it('reads open and paid expenses with their payee', () => {
    const open = snapshot.expenses.find((e) => e.id === 'ex_open')!;
    expect(open.status).toBe('open');
    expect(open.rawStatus).toBe('PENDING');
    expect(open.amount).toBe(60);
    expect(open.currency).toBe('EUR');
    expect(open.payee).toBe('Ada');
    expect(open.payeeSlug).toBe('ada');
    expect(open.createdAt).toBe(Date.parse('2026-05-25T09:00:00.000Z'));

    const paid = snapshot.expenses.find((e) => e.id === 'ex_paid')!;
    expect(paid.status).toBe('paid');
    expect(paid.type).toBe('INVOICE');
  });

  it('keeps an expense in its own currency and names a payee by slug alone', () => {
    const usd = snapshot.expenses.find((e) => e.id === 'ex_usd')!;
    expect(usd.currency).toBe('USD');
    expect(usd.amount).toBe(12.5);
    expect(usd.payee).toBe('bob');
  });

  it('drops an expense that was rejected or cancelled, whatever branch it came in', () => {
    expect(snapshot.expenses.some((e) => e.id === 'ex_gone')).toBe(false);
  });

  it('survives a response missing everything optional', () => {
    const empty = parseOpenCollectiveResponse({}, 'fallback', NOW);
    expect(empty.slug).toBe('fallback');
    expect(empty.name).toBe('fallback');
    expect(empty.balance).toBe(0);
    expect(empty.transactions).toEqual([]);
    expect(empty.expenses).toEqual([]);
  });

  it('does not throw on garbage', () => {
    // The whole point of the parser boundary: a third party changing its schema
    // must not take the view down.
    expect(() => parseOpenCollectiveResponse(null, 'x', NOW)).not.toThrow();
    expect(() => parseOpenCollectiveResponse('nope', 'x', NOW)).not.toThrow();
    expect(() =>
      parseOpenCollectiveResponse({ data: { transactions: { nodes: 'no' } } }, 'x', NOW),
    ).not.toThrow();
  });

  it('drops zero-value transactions', () => {
    const zeroed = parseOpenCollectiveResponse(
      {
        data: {
          transactions: {
            nodes: [{ id: 'z', type: 'CREDIT', amount: { value: 0, currency: 'EUR' } }],
          },
        },
      },
      'x',
      NOW,
    );
    expect(zeroed.transactions).toHaveLength(0);
  });

  it('falls back to the account currency for a transaction missing one', () => {
    const mixed = parseOpenCollectiveResponse(
      {
        data: {
          account: { currency: 'GBP' },
          transactions: { nodes: [{ id: 'a', type: 'CREDIT', amount: { value: 5 } }] },
        },
      },
      'x',
      NOW,
    );
    expect(mixed.transactions[0].currency).toBe('GBP');
  });
});
