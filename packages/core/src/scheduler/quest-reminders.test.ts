// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, expect, it } from 'vitest';
import {
  createQuestReminder,
  normalizeQuestReminder,
  questReminderLookupKey,
} from './quest-reminders.js';

describe('scheduler/quest-reminders', () => {
  it('createQuestReminder canonicalises shape', () => {
    const r = createQuestReminder({
      id: 'r1',
      questId: 'q1',
      holonId: 123 as unknown as string,
      when: '2026-06-01T10:00:00.000Z',
    });
    expect(r.holonId).toBe('123');
    expect(r.lens).toBe('quests');
    expect(r.title).toBe('Reminder');
    expect(typeof r.created).toBe('string');
  });

  it('normalizeQuestReminder promotes createdAt + coerces holonId', () => {
    const r = normalizeQuestReminder({
      id: 'r1',
      questId: 'q1',
      holonId: 123,
      when: '2026-06-01T10:00:00.000Z',
      createdAt: '2026-05-01T00:00:00.000Z',
    });
    expect(r?.holonId).toBe('123');
    expect(r?.created).toBe('2026-05-01T00:00:00.000Z');
    expect(r?.lens).toBe('quests');
    expect(normalizeQuestReminder(null)).toBeNull();
    expect(normalizeQuestReminder({ questId: 'q' })).toBeNull(); // no id
  });

  it('questReminderLookupKey matches telegram convention', () => {
    expect(questReminderLookupKey('H', 'q9')).toBe('Hq9');
  });
});
