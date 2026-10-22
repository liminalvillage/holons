// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, expect, it } from 'vitest';
import {
  createRecurringTask,
  normalizeRecurringTask,
  recurringLookupKey,
} from './recurring.js';
import { cronExpression } from './operations.js';

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

  it('normalizeRecurringTask keeps a usable `when` anchor', () => {
    const created = '2026-01-01T09:30:00.000Z';
    const base = { id: 'q1', holonId: 'H', title: 'x', frequency: 'daily', created };

    // A Date that round-tripped through JSON as `{}` — the shape that silently
    // dropped the task, because cronExpression(_, {}) is null.
    expect(normalizeRecurringTask({ ...base, when: {} })?.when).toBe(created);
    expect(normalizeRecurringTask({ ...base, when: undefined })?.when).toBe(created);
    expect(normalizeRecurringTask({ ...base, when: 'not a date' })?.when).toBe(created);

    // Readable anchors survive, normalised to ISO.
    expect(normalizeRecurringTask({ ...base, when: '2026-03-04T07:15:00.000Z' })?.when).toBe(
      '2026-03-04T07:15:00.000Z'
    );
    const ms = Date.parse('2026-03-04T07:15:00.000Z');
    expect(normalizeRecurringTask({ ...base, when: ms })?.when).toBe(
      '2026-03-04T07:15:00.000Z'
    );
    expect(normalizeRecurringTask({ ...base, when: new Date(ms) })?.when).toBe(
      '2026-03-04T07:15:00.000Z'
    );
  });

  it('a normalised legacy record yields a cron expression again', () => {
    const t = normalizeRecurringTask({
      id: '306_recurring',
      holonId: '-1004318065568',
      title: 'check in the chick ins',
      frequency: 'daily',
      when: {},
      created: '2026-01-01T09:30:00.000Z',
    });
    expect(cronExpression(t!.frequency as 'daily', t!.when)).toBe('30 9 * * *');
  });

  it('recurringLookupKey matches the telegram convention', () => {
    expect(recurringLookupKey('H', 'q9')).toBe('Hq9');
  });
});
