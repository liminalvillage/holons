import { describe, it, expect } from 'vitest';
import {
  questEmbedView,
  questSummaryLine,
  participantNames,
  shoppingListView,
  memberListView,
  balancesView,
  formatAmount,
  checklistView,
  checklistSummaryLine,
  leaderboardView,
} from './format.js';
import type { Quest } from '@holons/core/tasks';
import type { ShoppingChecklist } from '@holons/core/shopping';
import type { BalancesResult } from '@holons/core/expenses';
import type { Checklist } from '@holons/core/checklists';

function quest(overrides: Partial<Quest> = {}): Quest {
  return {
    title: 'Fix the fence',
    status: 'ongoing',
    type: 'task',
    participants: [],
    ...overrides,
  } as Quest;
}

describe('quest formatting', () => {
  it('lists participant display names, preferring username', () => {
    const q = quest({
      participants: [
        { id: 1, username: 'bob' },
        { id: 2, firstName: 'Carol' },
        { id: 3 },
      ],
    });
    expect(participantNames(q)).toEqual(['bob', 'Carol', '3']);
  });

  it('builds an embed view with type/status/participant fields', () => {
    const view = questEmbedView(quest({ location: 'Barn', when: 'Sat 10am' }));
    expect(view.title).toBe('Fix the fence');
    const fieldNames = view.fields.map(f => f.name);
    expect(fieldNames).toContain('Type');
    expect(fieldNames).toContain('Status');
    expect(fieldNames.some(n => n.startsWith('Participants'))).toBe(true);
    expect(fieldNames).toContain('When');
    expect(fieldNames).toContain('Where');
  });

  it('marks completed quests in the summary line', () => {
    expect(questSummaryLine(quest({ status: 'completed' }))).toContain('✅');
    expect(questSummaryLine(quest())).not.toContain('✅');
  });
});

describe('shopping formatting', () => {
  it('renders an empty-state for no items', () => {
    expect(shoppingListView(null)).toMatch(/empty/i);
  });

  it('groups items by category and shows checkbox state', () => {
    const list: ShoppingChecklist = {
      id: 'shopping',
      type: 'shopping',
      title: 'Shopping List',
      created: new Date().toISOString(),
      items: [
        { id: '1', text: 'Milk', checked: false, category: 'Dairy' },
        { id: '2', text: 'Eggs', checked: true, category: 'Dairy' },
        { id: '3', text: 'Nails', checked: false },
      ],
    };
    const out = shoppingListView(list);
    expect(out).toContain('__Dairy__');
    expect(out).toContain('⬜ Milk');
    expect(out).toContain('☑️ Eggs');
    expect(out).toContain('⬜ Nails');
  });
});

describe('member formatting', () => {
  it('prefers username, falls back to first_name then id', () => {
    expect(memberListView([{ id: 1, username: 'bob' }])).toContain('• bob');
    expect(memberListView([{ id: 2, first_name: 'Carol' }])).toContain(
      '• Carol'
    );
    expect(memberListView([{ id: 3 }])).toContain('• 3');
  });

  it('shows an empty state', () => {
    expect(memberListView([])).toMatch(/no members/i);
  });
});

describe('expense formatting', () => {
  it('formats amounts, dropping trailing .00', () => {
    expect(formatAmount(10)).toBe('10');
    expect(formatAmount(10.5)).toBe('10.50');
    expect(formatAmount(10.333)).toBe('10.33');
  });

  it('renders owed/owes lines and resolves names', () => {
    const result: BalancesResult = {
      creditMatrix: [],
      userIds: ['a', 'b'],
      balances: [
        { userId: 'a', net: 12.5 },
        { userId: 'b', net: -12.5 },
      ],
    };
    const out = balancesView(result, 'eur', id =>
      id === 'a' ? 'Alice' : 'Bob'
    );
    expect(out).toContain('🟢 **Alice** is owed 12.50 EUR');
    expect(out).toContain('🔴 **Bob** owes 12.50 EUR');
  });

  it('reports a settled state when all balances are ~zero', () => {
    const result: BalancesResult = {
      creditMatrix: [],
      userIds: ['a'],
      balances: [{ userId: 'a', net: 0 }],
    };
    expect(balancesView(result, 'usd')).toMatch(/settled up/i);
  });
});

describe('checklist formatting', () => {
  function checklist(items: Checklist['items']): Checklist {
    return { id: 'chores', type: 'checklist', items };
  }

  it('renders items with checkbox state', () => {
    const out = checklistView(
      checklist([
        { text: 'Sweep', checked: true },
        { text: 'Mop', checked: false },
      ])
    );
    expect(out).toContain('☑️ Sweep');
    expect(out).toContain('⬜ Mop');
  });

  it('summarises done/total', () => {
    const line = checklistSummaryLine(
      checklist([
        { text: 'a', checked: true },
        { text: 'b', checked: false },
      ])
    );
    expect(line).toContain('chores');
    expect(line).toContain('1/2');
  });

  it('shows an empty state', () => {
    expect(checklistView(checklist([]))).toMatch(/empty/i);
  });
});

describe('leaderboard formatting', () => {
  it('sorts by score descending and medals the top three', () => {
    const out = leaderboardView([
      { name: 'Bob', score: 8, percentage: 30 },
      { name: 'Alice', score: 12, percentage: 45 },
      { name: 'Carol', score: 4, percentage: 15 },
      { name: 'Dan', score: 2, percentage: 10 },
    ]);
    const lines = out.split('\n');
    expect(lines[0]).toContain('🥇');
    expect(lines[0]).toContain('Alice');
    expect(lines[1]).toContain('🥈');
    expect(lines[1]).toContain('Bob');
    expect(lines[2]).toContain('🥉');
    expect(lines[3]).toContain('4.'); // numbered after the medals
    expect(lines[0]).toContain('(45%)');
  });

  it('shows an empty state', () => {
    expect(leaderboardView([])).toMatch(/no contributions/i);
  });
});
