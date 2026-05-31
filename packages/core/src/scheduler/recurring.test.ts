// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, expect, it } from 'vitest';
import {
  createRecurringTask,
  normalizeRecurringTask,
  recurringLookupKey,
} from './recurring.js';

describe('scheduler/recurring', () => {
  it('createRecurringTask stringifies holonId and stamps created ISO', () => {
    const t = createRecurringTask({
      id: 'q1',
      holonId: 123 as unknown as string,
      title: 'water plants',
      frequency: 'weekly',
    });
    expect(t.holonId).toBe('123');
    expect(t.title).toBe('water plants');
    expect(t.frequency).toBe('weekly');
    expect(typeof t.created).toBe('string');
    expect(typeof t.when).toBe('string');
  });

  it('normalizeRecurringTask promotes legacy createdAt + coerces holonId', () => {
    const ms = Date.parse('2026-01-01T00:00:00.000Z');
    const t = normalizeRecurringTask({
      id: 'q1',
      holonId: 123,
      title: 'x',
      frequency: 'daily',
      when: '2026-01-01T09:00:00.000Z',
      createdAt: ms,
    });
    expect(t?.holonId).toBe('123');
    expect(t?.created).toBe('2026-01-01T00:00:00.000Z');
    expect(normalizeRecurringTask(null)).toBeNull();
  });

  it('recurringLookupKey matches the telegram convention', () => {
    expect(recurringLookupKey('H', 'q9')).toBe('Hq9');
  });
});
