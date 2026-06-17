// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, expect, it } from 'vitest';
import { createRole } from './operations.js';
import {
  clearDay,
  clearPermanent,
  hasPermanent,
  holdersForDate,
  isHolderOnDate,
  isPermanentHolder,
  isoDateOf,
  permanentHolders,
  setDayUsers,
  setPermanent,
  todayHolder,
  toggleDayUser,
  weekDaysOf,
  weekKeyOf,
} from './schedule.js';

// Built from local components so the date keys don't drift with the test TZ.
const thu = new Date(2026, 5, 18, 12); // Thu 18 Jun 2026, noon
const nextWeek = new Date(2026, 5, 25, 12); // Thu 25 Jun 2026, noon

describe('roles/schedule date keys', () => {
  it('weekKeyOf returns ISO-week strings', () => {
    expect(weekKeyOf(new Date(2026, 0, 1, 12))).toBe('2026-W01'); // Thu = week 1
    expect(weekKeyOf(thu)).toMatch(/^2026-W\d{2}$/);
    expect(weekKeyOf(thu)).not.toBe(weekKeyOf(nextWeek));
  });

  it('weekDaysOf returns Monday→Sunday', () => {
    const days = weekDaysOf(weekKeyOf(thu));
    expect(days).toHaveLength(7);
    expect(days[0].getDay()).toBe(1); // Monday
    expect(days[6].getDay()).toBe(0); // Sunday
  });

  it('isoDateOf is YYYY-MM-DD', () => {
    expect(isoDateOf(thu)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('roles/schedule fixed holders', () => {
  it('setPermanent makes a sole fixed holder; clearPermanent removes it', () => {
    let role = createRole('Cook');
    role = setPermanent(role, { id: 7, username: 'Sam' });
    expect(hasPermanent(role)).toBe(true);
    expect(permanentHolders(role).map((p) => p.id)).toEqual([7]);
    expect(isPermanentHolder(role, 7)).toBe(true);
    expect(isPermanentHolder(role, 9)).toBe(false);

    // Re-assigning replaces — there is only ever one fixed holder.
    role = setPermanent(role, { id: 9, username: 'Ada' });
    expect(permanentHolders(role).map((p) => p.id)).toEqual([9]);

    role = clearPermanent(role);
    expect(hasPermanent(role)).toBe(false);
  });

  it('a fixed holder overrides the week schedule, every day', () => {
    let role = createRole('Cook');
    role = setDayUsers(role, thu, [{ id: 1, username: 'Day' }]);
    role = setPermanent(role, { id: 2, username: 'Fixed' });
    expect(holdersForDate(role, thu).map((p) => p.id)).toEqual([2]);
    // ...even on a day the schedule never touched.
    expect(holdersForDate(role, nextWeek).map((p) => p.id)).toEqual([2]);
  });
});

describe('roles/schedule per-day', () => {
  it('setDayUsers/holdersForDate round-trip without mutating the input', () => {
    const role = createRole('Greeter');
    const next = setDayUsers(role, thu, [{ id: 5, username: 'Mo' }]);
    expect(role.weekSchedule).toBeUndefined(); // input untouched
    expect(holdersForDate(next, thu).map((p) => p.id)).toEqual([5]);
    expect(next.weekSchedule?.weekKey).toBe(weekKeyOf(thu));
  });

  it('scopes holders to the schedule’s own week', () => {
    const role = setDayUsers(createRole('Greeter'), thu, [{ id: 5 }]);
    expect(holdersForDate(role, thu).map((p) => p.id)).toEqual([5]);
    expect(holdersForDate(role, nextWeek)).toEqual([]); // a different week
  });

  it('toggleDayUser assigns then clears', () => {
    const role = createRole('Greeter');
    const user = { id: 5, username: 'Mo' };
    let r = toggleDayUser(role, thu, user);
    expect(r.assigned).toBe(true);
    expect(isHolderOnDate(r.role, thu, 5)).toBe(true);
    r = toggleDayUser(r.role, thu, user);
    expect(r.assigned).toBe(false);
    expect(isHolderOnDate(r.role, thu, 5)).toBe(false);
  });

  it('assigning a day replaces the previous holder', () => {
    let role = setDayUsers(createRole('Greeter'), thu, [{ id: 1 }]);
    role = toggleDayUser(role, thu, { id: 2 }).role;
    expect(holdersForDate(role, thu).map((p) => p.id)).toEqual([2]);
  });

  it('repoints the schedule when a different week is scheduled', () => {
    let role = setDayUsers(createRole('Greeter'), thu, [{ id: 1 }]);
    role = setDayUsers(role, nextWeek, [{ id: 2 }]);
    expect(role.weekSchedule?.weekKey).toBe(weekKeyOf(nextWeek));
    expect(holdersForDate(role, nextWeek).map((p) => p.id)).toEqual([2]);
    expect(holdersForDate(role, thu)).toEqual([]); // the old week is gone
  });

  it('clearDay empties a day', () => {
    let role = setDayUsers(createRole('Greeter'), thu, [{ id: 1 }]);
    role = clearDay(role, thu);
    expect(holdersForDate(role, thu)).toEqual([]);
  });
});

describe('roles/schedule todayHolder', () => {
  it('prefers fixed, then the day, then the first participant', () => {
    const withMember = {
      ...createRole('Cook'),
      participants: [{ id: 3, username: 'Lee' }],
    };
    expect(todayHolder(withMember, thu)?.id).toBe(3); // participant fallback
    const scheduled = setDayUsers(withMember, thu, [{ id: 4 }]);
    expect(todayHolder(scheduled, thu)?.id).toBe(4); // day beats fallback
    const fixed = setPermanent(scheduled, { id: 9 });
    expect(todayHolder(fixed, thu)?.id).toBe(9); // fixed beats day
    expect(todayHolder(createRole('Empty'), thu)).toBeNull();
  });
});
