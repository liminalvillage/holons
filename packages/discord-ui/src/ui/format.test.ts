import { describe, it, expect } from 'vitest';
import {
  questEmbedView,
  questSummaryLine,
  participantNames,
  shoppingListView,
} from './format.js';
import type { Quest } from '@holons/core/tasks';
import type { ShoppingChecklist } from '@holons/core/shopping';

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
